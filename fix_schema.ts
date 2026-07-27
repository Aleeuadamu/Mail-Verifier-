import fs from 'fs';
let content = fs.readFileSync('api/index.ts', 'utf8');

// Replace string | null with string | "NOT VERIFIED"
content = content.replace(/"ip_address": string \| null/g, '"ip_address": string | "NOT VERIFIED"');
content = content.replace(/"country": string \| null/g, '"country": string | "NOT VERIFIED"');
content = content.replace(/"region": string \| null/g, '"region": string | "NOT VERIFIED"');
content = content.replace(/"city": string \| null/g, '"city": string | "NOT VERIFIED"');
content = content.replace(/"isp": string \| null/g, '"isp": string | "NOT VERIFIED"');
content = content.replace(/"asn": string \| null/g, '"asn": string | "NOT VERIFIED"');
content = content.replace(/"hosting_provider": string \| null/g, '"hosting_provider": string | "NOT VERIFIED"');
content = content.replace(/"vpn_detected": boolean,/g, '"vpn_detected": boolean | "NOT VERIFIED",');
content = content.replace(/"proxy_detected": boolean,/g, '"proxy_detected": boolean | "NOT VERIFIED",');
content = content.replace(/"datacenter_detected": boolean/g, '"datacenter_detected": boolean | "NOT VERIFIED"');

content = content.replace(/"urgency_tactics": boolean,/g, '"urgency_tactics": boolean | "NOT VERIFIED",');
content = content.replace(/"fear_tactics": boolean,/g, '"fear_tactics": boolean | "NOT VERIFIED",');
content = content.replace(/"authority_impersonation": boolean,/g, '"authority_impersonation": boolean | "NOT VERIFIED",');
content = content.replace(/"credential_theft_attempt": boolean,/g, '"credential_theft_attempt": boolean | "NOT VERIFIED",');
content = content.replace(/"payment_fraud_attempt": boolean,/g, '"payment_fraud_attempt": boolean | "NOT VERIFIED",');
content = content.replace(/"invoice_scam": boolean,/g, '"invoice_scam": boolean | "NOT VERIFIED",');
content = content.replace(/"bec_detected": boolean/g, '"bec_detected": boolean | "NOT VERIFIED"');

fs.writeFileSync('api/index.ts', content, 'utf8');
