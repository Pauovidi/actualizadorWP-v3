diff --git a/app/api/update/route.ts b/app/api/update/route.ts
index 1111111..2222222 100644
--- a/app/api/update/route.ts
+++ b/app/api/update/route.ts
@@ -1,78 +1,86 @@
 import { NextResponse } from "next/server";
 
-export async function POST(req: Request) {
-  try {
-    const payload = await req.json(); // { siteUrl, token, screenshot? }
-    const { siteUrl, token } = payload;
-    if (!siteUrl || !token) {
-      return NextResponse.json({ ok: false, error: "Missing siteUrl/token" }, { status: 400 });
-    }
-
-    const res = await fetch(`${siteUrl.replace(/\/+$/,"")}/wp-json/maint-agent/v1/update`, {
-      method: "POST",
-      headers: {
-        "Authorization": `Bearer ${token}`,
-        "Content-Type": "application/json",
-        "Accept": "application/json",
-        "User-Agent": "wp-maint-agent/ui"
-      },
-      body: JSON.stringify({ screenshot: false })
-    });
-
-    const text = await res.text();
-    let data: unknown = null;
-    try { data = JSON.parse(text); } catch { /* dejar text por si WP devuelve HTML */ }
-
-    if (!res.ok) {
-      console.error("WP update error", res.status, text?.slice?.(0, 500));
-      return NextResponse.json({ ok: false, status: res.status, body: text || data }, { status: 502 });
-    }
-
-    return NextResponse.json({ ok: true, result: data ?? text });
-  } catch (err: any) {
-    console.error("API /api/update error", err?.message || err);
-    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
-  }
-}
+export async function POST(req: Request) {
+  try {
+    // aceptamos JSON o form-data; si no viene JSON no pasa nada
+    let siteUrl = "";
+    let token = "";
+    try {
+      const payload = await req.json(); // { siteUrl, token }
+      siteUrl = payload?.siteUrl || "";
+      token   = payload?.token || "";
+    } catch {
+      // fallback por si vino como form-data
+      const fd = await req.formData();
+      siteUrl = (fd.get("siteUrl") as string) || "";
+      token   = (fd.get("token") as string) || "";
+    }
+
+    if (!siteUrl || !token) {
+      return NextResponse.json({ ok: false, error: "Missing siteUrl/token" }, { status: 400 });
+    }
+
+    const endpoint = `${siteUrl.replace(/\/+$/,"")}/wp-json/maint-agent/v1/update`;
+    const res = await fetch(endpoint, {
+      method: "POST",
+      // === Clave: MISMA LÓGICA QUE EL CLI PYTHON ===
+      // - Sin body
+      // - Sin Content-Type
+      // - Sin Authorization
+      headers: {
+        "Accept": "application/json",
+        "User-Agent": "wp-maint-agent/ui",
+        "X-MAINT-TOKEN": token,
+      },
+    });
+
+    const text = await res.text();
+    let data: unknown = null;
+    try { data = JSON.parse(text); } catch { /* dejar text por si WP devuelve HTML */ }
+
+    if (!res.ok) {
+      console.error("WP update error", res.status, text?.slice?.(0, 500));
+      return NextResponse.json({ ok: false, status: res.status, body: text || data }, { status: 502 });
+    }
+
+    return NextResponse.json({ ok: true, result: data ?? text });
+  } catch (err: any) {
+    console.error("API /api/update error", err?.message || err);
+    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
+  }
+}
