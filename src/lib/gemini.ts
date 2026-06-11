export interface EmailData {
  id?: string;
  subject: string;
  body: string;
  senderName: string;
  senderEmail: string;
  replyTo?: string;
  headers?: string;
  links?: string;
}

export type AnalysisMode = "INBOX_SCAN" | "SINGLE_EMAIL_VIEW" | "REALTIME_ALERT";

export async function analyzeEmail(data: EmailData | EmailData[], mode: AnalysisMode = "SINGLE_EMAIL_VIEW") {
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data, mode }),
    });

    if (!res.ok) {
      let errorMsg = `Analysis failed with status ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson && errJson.error) {
          errorMsg = errJson.error;
        }
      } catch (e) {}
      throw new Error(errorMsg);
    }

    const json = await res.json();
    return json.result;
  } catch (error) {
    console.error("Analysis Request Error:", error);
    return null;
  }
}

