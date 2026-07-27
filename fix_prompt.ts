import fs from 'fs';
let content = fs.readFileSync('api/index.ts', 'utf8');

const regex = /TASK: Perform a complete audit of the email. You will be given pre-verified technical data in VERIFIED_TECHNICAL_DATA.[^`]+Expected JSON Schema:/s;

const newInstructions = `TASK: Perform a complete, highly accurate audit of the email. You will be given pre-verified technical data in VERIFIED_TECHNICAL_DATA.
CRITICAL: Do NOT invent, guess, or hallucinate any technical values (like SPF, DKIM, IPs, locations, ISPs, VPNs, or Threat Intel). You MUST ONLY summarize the verified data provided. If a specific data point says "NOT VERIFIED" or is not provided, you MUST output "NOT VERIFIED" for that field. 
CRITICAL: For the content analysis (urgency tactics, credential theft, typosquatting), you MUST deeply analyze the BODY content and subject of the specific email provided. Do not use static responses. Base your threat and risk scores on actual detected text patterns in the BODY.

Respond ONLY with a valid JSON object matching this schema. NO Markdown formatting blocks around the JSON.
EMAIL_SUBJECT: \${singleData.subject}
SENDER_NAME: \${singleData.senderName}
SENDER_EMAIL: \${singleData.senderEmail}
REPLY_TO: \${singleData.replyTo || "N/A"}
LINKS: \${singleData.links || "N/A"}
HEADERS: \${singleData.headers || "N/A"}
BODY: \${singleData.body}

Expected JSON Schema:`;

content = content.replace(regex, newInstructions);
fs.writeFileSync('api/index.ts', content, 'utf8');
