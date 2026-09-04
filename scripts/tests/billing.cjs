const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { cents, normalizeInvoice, QuipuClient } = require('../../.test-build/lib/billing/quipu');
const { StripeTestClient, verifyStripeEvent } = require('../../.test-build/lib/billing/stripe');
const { authorizeTest, testPool } = require('../../.test-build/lib/billing/config');
const { syncInvoices, prepareReports, collectPayments } = require('../../.test-build/lib/billing/service');
const period = '2026-09';
const pdf = Buffer.from('%PDF-1.4\nfixture');
const invoice = { id: '11', contactId: '22', period, number: 'TEST-1', amountCents: 10600, paymentStatus: 'unpaid' };
const client = { id: '1', quipu_contact_id: '22', billing_email: 'fixture@example.invalid', payment_mode: 'manual',
  billing_frequency: 'monthly', quarterly_months: [3,6,9,12], sites: [{ name:'Fixture',url:'https://example.invalid' }] };
const resource = { id:'11',type:'invoices',attributes:{kind:'income',stage:'final',number:'TEST-1',issue_date:'2026-09-05',
  total_amount:'106.00',payment_status:'unpaid'},relationships:{contact:{data:{id:'22'}}} };
const response = data => new Response(JSON.stringify(data), {headers:{'content-type':'application/json'}});

function memory(clients = [structuredClone(client)]) {
  const invoices = new Map(), runs = new Map(), payments = new Map(), outbox = new Map();
  return { invoices, runs, payments, outbox,
    async clients() { return clients; },
    async invoice(id,p) { return invoices.get(`${id}:${p}`) || null; },
    async importInvoice(id,i,pdf) { const key=`${id}:${i.period}`; if(invoices.has(key)) throw Error('conflict'); invoices.set(key,{...i,pdf}); },
    async claimRun(id,p) { const key=`${id}:${p}`; if(runs.has(key))return false; runs.set(key,'STARTED');return true; },
    async prepare(id,p,payload) { outbox.set(`${id}:${p}`,payload); runs.set(`${id}:${p}`,'PREPARED'); },
    async reviewRun(id,p) {runs.set(`${id}:${p}`,'REVIEW_REQUIRED');},
    async claimPayment(id) { if(payments.has(id))return false; payments.set(id,{status:'SUBMITTING'});return true; },
    async savePayment(id,intent,status) {payments.set(id,{id:intent,status});},
  };
}
const quipu = { async list(){return [invoice];}, async pdf(){return pdf;}, async get(){return invoice;} };
const demo = async()=>({reportHtml:'data:text/html;base64,SGVsbG8=',reportFileName:'report.html'});

test('exact amounts, no floating point rounding or malformed totals',()=>{
  assert.equal(cents('53.00'),5300);assert.equal(cents('0.01'),1);assert.equal(cents('106.6'),10660);
  for(const v of ['0','-5','1,20','1.234','1e3',53,null,'1000000'])assert.throws(()=>cents(v));
});
test('only final income invoices in the requested month with explicit contact',()=>{
  assert.equal(normalizeInvoice(resource,period).amountCents,10600);
  for(const patch of [{stage:'draft'},{kind:'expenses'},{issue_date:'2026-08-05'},{number:''}])
    assert.throws(()=>normalizeInvoice({...resource,attributes:{...resource.attributes,...patch}},period));
  assert.throws(()=>normalizeInvoice({...resource,relationships:{}},period));
});
test('Quipu pagination fetches every page with current owner-prefixed API and Basic OAuth',async()=>{
  const calls=[];
  const api=new QuipuClient({owner:'fixture',clientId:'fixture',clientSecret:'fixture',currency:'EUR'},async(url,init)=>{
    calls.push([url,init]);
    if(url.endsWith('/oauth/token')) {assert.equal(init.body,'grant_type=client_credentials&scope=ecommerce');assert.match(init.headers.Authorization,/^Basic /);return response({access_token:'fixture',expires_in:7200});}
    const page=Number(new URL(url).searchParams.get('page[number]'));
    return response({data:[{...resource,id:String(page)}],meta:{pagination_info:{current_page:page,total_pages:2}}});
  },async()=>{});
  assert.equal((await api.list(period)).length,2);
  assert.equal(calls.length,3);assert.match(calls[1][0],/getquipu.com\/fixture\/invoices/);
});
test('missing pagination fails closed; bad PDF never imported',async()=>{
  const config={owner:'fixture',clientId:'fixture',clientSecret:'fixture',currency:'EUR'};
  const api=new QuipuClient(config,async(url)=>url.endsWith('/oauth/token')?response({access_token:'fixture',expires_in:7200}):response({data:[]}),async()=>{});
  await assert.rejects(()=>api.list(period),/pagination/);
  const bad=new QuipuClient(config,async(url)=>url.endsWith('/oauth/token')?response({access_token:'fixture',expires_in:7200}):new Response('error',{headers:{'content-type':'application/pdf'}}),async()=>{});
  await assert.rejects(()=>bad.pdf('11'),/signature/);
});
test('plan is read-only; repeated import preserves original invoice',async()=>{
  const store=memory();let downloads=0;
  const api={...quipu,async pdf(){downloads++;return pdf;}};
  assert.equal((await syncInvoices(store,api,period))[0].status,'WOULD_IMPORT');
  assert.equal(downloads,0);assert.equal(store.invoices.size,0);
  await syncInvoices(store,api,period,true);await syncInvoices(store,api,period,true);
  assert.equal(downloads,1);assert.equal(store.invoices.size,1);
  const altered={...api,async list(){return [{...invoice,amountCents:5300}];}};
  assert.equal((await syncInvoices(store,altered,period,true))[0].status,'CONFLICT_REVIEW_REQUIRED');
  assert.equal((await store.invoice('1',period)).amountCents,10600);
});
test('multiple invoices or unknown contacts cannot be assigned by email guess',async()=>{
  const store=memory();
  assert.equal((await syncInvoices(store,{...quipu,async list(){return [invoice,{...invoice,id:'12'}];}},period,true))[0].status,'AMBIGUOUS_INVOICES');
  assert.equal((await syncInvoices(store,{...quipu,async list(){return [{...invoice,contactId:'999'}];}},period,true))[0].status,'MISSING_INVOICE');
  assert.equal(store.invoices.size,0);
});
test('missing required invoice blocks report work; quarterly non-due sends reports only',async()=>{
  let calls=0;const report=async()=>{calls++;return demo();};
  await prepareReports(memory(),period,report,true);assert.equal(calls,0);
  const store=memory([{...client,billing_frequency:'quarterly',quarterly_months:[1,4,7,10]}]);
  await prepareReports(store,period,report,true);assert.equal(calls,1);
  assert.equal(store.outbox.get('1:'+period).invoice,null);
});
test('grouped reports use existing send payload; repeated run does not regenerate',async()=>{
  const store=memory([{...client,sites:[...client.sites,{name:'Second',url:'https://example.org'}]}]);
  await syncInvoices(store,quipu,period,true);let calls=0;
  const report=async()=>{calls++;return demo();};
  await prepareReports(store,period,report,false);assert.equal(calls,0);assert.equal(store.runs.size,0);
  await prepareReports(store,period,report,true);await prepareReports(store,period,report,true);
  assert.equal(calls,2);const payload=store.outbox.get('1:'+period);
  assert.equal(payload.reports.length,2);assert.equal(payload.invoice.base64,pdf.toString('base64'));
});
test('manual clients never call Stripe; mandate required for opt-in',async()=>{
  let calls=0;const stripe={async charge(){calls++;}};
  const store=memory();await syncInvoices(store,quipu,period,true);
  assert.equal((await collectPayments(store,quipu,stripe,'fixture',period,true))[0].status,'MANUAL_PAYMENT');
  const opt=memory([{...client,payment_mode:'stripe_sepa'}]);await syncInvoices(opt,quipu,period,true);
  assert.equal((await collectPayments(opt,quipu,stripe,'fixture',period,true))[0].status,'NO_ACCEPTED_MANDATE');assert.equal(calls,0);
});
const sepaClient={...client,payment_mode:'stripe_sepa',stripe_customer_id:'cus_test',payment_method_id:'pm_test',mandate_id:'mandate_test'};
test('re-read Quipu catches manual payment or amount changes before charging',async()=>{
  for(const patch of [{paymentStatus:'paid'},{paymentStatus:'partially_paid'},{amountCents:20000}]){
    const store=memory([sepaClient]);await syncInvoices(store,quipu,period,true);
    const result=await collectPayments(store,{async get(){return {...invoice,...patch};}},{async charge(){assert.fail('must not charge');}},'fixture',period,true);
    assert.equal(result[0].status,'INVOICE_REVIEW_REQUIRED');assert.equal(store.payments.size,0);
  }
});
test('concurrent and retried payments make a single attempt; processing is not paid',async()=>{
  const store=memory([sepaClient]);await syncInvoices(store,quipu,period,true);let calls=0;
  const stripe={async charge(){calls++;return {id:'pi_test',status:'processing',amount:10600,currency:'eur',livemode:false};}};
  await Promise.all([collectPayments(store,quipu,stripe,'fixture',period,true),collectPayments(store,quipu,stripe,'fixture',period,true)]);
  assert.equal(calls,1);assert.equal(store.payments.get('11').status,'processing');
});
test('unknown provider result remains blocked for reconciliation, not retried',async()=>{
  const store=memory([sepaClient]);await syncInvoices(store,quipu,period,true);let calls=0;
  const stripe={async charge(){calls++;throw Error('timeout after submission');}};
  await collectPayments(store,quipu,stripe,'fixture',period,true);await collectPayments(store,quipu,stripe,'fixture',period,true);
  assert.equal(calls,1);assert.equal(store.payments.get('11').status,'REVIEW_REQUIRED');
});
test('Stripe rejects live keys before any network; verifies mandate ownership and acceptance',async()=>{
  assert.throws(()=>new StripeTestClient('sk_live_fixture'),/test/);
  const api=new StripeTestClient('sk_test_fixture',async(url)=>response(url.includes('/mandates/')?
    {livemode:false,status:'active',type:'multi_use',payment_method:'pm_test',customer_acceptance:{accepted_at:1}}:
    {livemode:false,type:'sepa_debit',customer:'cus_wrong'}));
  await assert.rejects(()=>api.verifyMandate({customerId:'cus_test',paymentMethodId:'pm_test',mandateId:'mandate_test'}),/different client/);
});
test('Stripe uses only PaymentIntents with stable idempotency, no invoices or subscriptions',async()=>{
  const calls=[];const api=new StripeTestClient('sk_test_fixture',async(url,init)=>{
    calls.push([url,init]);
    if(url.includes('/mandates/'))return response({livemode:false,status:'active',type:'multi_use',payment_method:'pm_test',customer_acceptance:{accepted_at:1}});
    if(url.includes('/payment_methods/'))return response({livemode:false,type:'sepa_debit',customer:'cus_test'});
    return response({livemode:false,id:'pi_test',status:'processing',amount:10600,currency:'eur'});
  });
  const b={customerId:'cus_test',paymentMethodId:'pm_test',mandateId:'mandate_test'};
  await api.charge(invoice,'fixture',b);await api.charge(invoice,'fixture',b);
  const posts=calls.filter(([,i])=>i.method==='POST');assert.equal(posts.length,2);
  assert.equal(posts[0][1].headers['Idempotency-Key'],posts[1][1].headers['Idempotency-Key']);
  assert.equal(posts[0][1].body.get('amount'),'10600');assert.equal(posts[0][1].body.get('off_session'),'true');
  assert.ok(posts.every(([url])=>url.endsWith('/payment_intents')));
});
test('signed webhook accepts test event and rejects tampering, age, and live events',()=>{
  const now=1788516000000,t=String(now/1000),secret='fixture';
  const raw=JSON.stringify({id:'evt_test',livemode:false});
  const sign=body=>`t=${t},v1=${createHmac('sha256',secret).update(`${t}.${body}`).digest('hex')}`;
  assert.equal(verifyStripeEvent(raw,sign(raw),secret,now).id,'evt_test');
  assert.throws(()=>verifyStripeEvent(raw+' ',sign(raw),secret,now));
  assert.throws(()=>verifyStripeEvent(raw,sign(raw),secret,now+301000));
  const live=JSON.stringify({id:'evt_live',livemode:true});assert.throws(()=>verifyStripeEvent(live,sign(live),secret,now));
});
test('administrative routes fail closed when disabled, unauthenticated or production',()=>{
  const token='fixture'.repeat(6),req=new Request('https://example.invalid',{headers:{authorization:`Bearer ${token}`}});
  const env={BILLING_INTEGRATION_MODE:'test',BILLING_TEST_ADMIN_TOKEN:token};
  assert.equal(authorizeTest(req,env),true);assert.equal(authorizeTest(req,{}),false);
  assert.equal(authorizeTest(req,{...env,VERCEL_ENV:'production'}),false);
  assert.equal(authorizeTest(new Request('https://example.invalid'),env),false);
  assert.throws(()=>testPool({...env,BILLING_TEST_DATABASE_URL:'postgres://a:b@host/db',DATABASE_URL:'postgres://other:password@host/db'}),/Production/);
});
test('legacy cron dry-run cannot perform writes, WP calls or email, even when invoice is missing',async()=>{
  const Module=require('node:module'),original=Module._load,originalFetch=global.fetch,oldSecret=process.env.CRON_SECRET;
  let hasInvoice=true;const queries=[];
  const pool={async query(sql){queries.push(sql);assert.match(sql,/^\s*SELECT/);
    if(sql.includes('FROM sites'))return {rows:[{name:'Fixture',url:'https://example.invalid',token:'fixture',email:'test@example.invalid',billing_frequency:'monthly'}]};
    if(sql.includes('FROM invoices'))return {rows:hasInvoice?[{file_name:'test.pdf',blob_url:'https://example.invalid/test.pdf'}]:[]};
    return {rows:[]};}};
  Module._load=function(name,parent,isMain){if(name==='@/lib/db')return {dbPool:()=>pool};return original.call(this,name,parent,isMain);};
  global.fetch=async()=>{assert.fail('dry run must not fetch');};process.env.CRON_SECRET='fixture';
  try{
    const route=require('../../.test-build/app/api/cron/billing-run/route');
    for(hasInvoice of [true,false]){
      const result=await route.POST(new Request('https://example.invalid/api/cron/billing-run?dryRun=1',{method:'POST',headers:{authorization:'Bearer fixture'}}));
      assert.equal(result.status,200);
    }
    assert.ok(queries.length>=6);
  }finally{Module._load=original;global.fetch=originalFetch;if(oldSecret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=oldSecret;}
});
