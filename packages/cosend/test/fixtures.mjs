// Fixtures for the webhook tests. Every signature below was computed with OpenSSL 3.5.4
// (30 Sep 2025) in Git Bash on 10 Nov 2026, never by the code under test:
//
//   SECRET_OLD='whsec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'  (gitleaks:allow)
//   SECRET_NEW='whsec_fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'  (gitleaks:allow)
//   T=1794312000                      # 2026-11-10T12:00:00Z
//   BODY='<EVENT_BODY below, exactly>'
//   FWD_SECRET='9b1f2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9'  (gitleaks:allow)
//   FWD_BODY='<FORWARDED_BODY below, exactly>'
//
//   $ printf %s "$T.$BODY" | openssl dgst -sha256 -hmac "$SECRET_OLD"
//   SHA2-256(stdin)= 0a0c66d5284ef4069c61662174f136672bec3daf0a888b5d35f3830bfabbfd24
//   $ printf %s "$T.$BODY" | openssl dgst -sha256 -hmac "$SECRET_NEW"
//   SHA2-256(stdin)= b8c211d11a804313b3291b0caa1595331f0c11682e9037529c02d92703ee3a00
//   $ printf %s "$FWD_BODY" | openssl dgst -sha256 -hmac "$FWD_SECRET"
//   SHA2-256(stdin)= c7638616e4d3ea718037b022218d0c0517c8e98e39e3ea5a03c56f1b8fe676a3
//
// The secrets are made-up test values in the real formats: an event endpoint's signing secret, as
// POST /v1/webhook-endpoints returns it, is `whsec_` plus 64 hex characters. The HMAC key is the
// whole string, prefix included. Each made-up value carries gitleaks:allow, so a secret scanner run
// over this repository reports only real findings.

export const SECRET_OLD = "whsec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"; // gitleaks:allow
export const SECRET_NEW = "whsec_fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"; // gitleaks:allow
export const T = 1794312000;

export const EVENT_BODY =
  '{"id":"evt_01K9Q3Z8M4X7C2N6V5B1T0RYHE","object":"event","type":"message.received","api_version":"v1","created_at":"2026-11-10T12:00:00.000Z","organization_id":"org_01K9Q3Z8M4X7C2N6V5B1T0RYHA","connection_id":"conn_01K9Q3Z8M4X7C2N6V5B1T0RYHB","data":{"object":{"id":"msg_01K9Q3Z8M4X7C2N6V5B1T0RYHC","object":"message","type":"text","direction":"inbound","content":{"body":"Is my order on its way?"}}}}';

/** HMAC-SHA256(SECRET_OLD, `${T}.${EVENT_BODY}`), from openssl above. */
export const V1_OLD = "0a0c66d5284ef4069c61662174f136672bec3daf0a888b5d35f3830bfabbfd24";
/** HMAC-SHA256(SECRET_NEW, `${T}.${EVENT_BODY}`), from openssl above. */
export const V1_NEW = "b8c211d11a804313b3291b0caa1595331f0c11682e9037529c02d92703ee3a00";

export const FWD_SECRET = "9b1f2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9"; // gitleaks:allow
export const FORWARDED_BODY =
  '{"object":"whatsapp_business_account","entry":[{"id":"102290129340398","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550783881","phone_number_id":"106540352242922"},"messages":[{"from":"919876543210","id":"wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhggQTZCRUY3QjI0QjE3RDFBQ0FFRDQ2MDUzMjU0NzY0NUEA","timestamp":"1794312000","type":"text","text":{"body":"Is my order on its way?"}}]}}]}]}';
/** HMAC-SHA256(FWD_SECRET, FORWARDED_BODY), from openssl above. */
export const FWD_SIG = "c7638616e4d3ea718037b022218d0c0517c8e98e39e3ea5a03c56f1b8fe676a3";
