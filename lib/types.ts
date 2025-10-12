export type SiteInput = {
  name: string;
  url: string;
  token: string;
  screenshotUrl?: string;

  emailTo?: string;
  invoiceName?: string;
  invoiceType?: string;
  invoiceB64?: string;
};

export type UpdateResultItem = {
  kind: string;
  name: string;
  from?: string;
  to?: string;
  status?: "ok" | "warn" | "err";
  note?: string;
};

export type UpdateResponse = {
  status: "ok" | "error";
  updated: UpdateResultItem[];
  errors: string[];
  notes?: string;
  startedAt: string;
};

export type ApiUpdateResponse = {
  sites: Array<{
    site: SiteInput;
    ok: boolean;
    response?: UpdateResponse;
    error?: string;
    reportHtml?: string;
  }>;
  error?: any;
};
