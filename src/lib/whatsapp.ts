/** Returns the number in WhatsApp format (country code + number, digits only), or null if it looks wrong.
 *  10-digit numbers are treated as Indian (+91). Other countries: type the number with a leading +. */
export function waNumber(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  const d = text.replace(/\D/g, "");
  if (text.startsWith("+") && d.length >= 11 && d.length <= 15) return d;
  if (d.length === 10) return "91" + d;
  if (d.length === 11 && d.startsWith("0")) return "91" + d.slice(1);
  if (d.length === 12 && d.startsWith("91")) return d;
  return null;
}

export const waLink = (number: string, text: string) => `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

export type TemplateKind = "reminder" | "notice" | "greeting" | "custom";

export const TEMPLATES: Record<"en" | "mr", Record<TemplateKind, string>> = {
  en: {
    reminder: "Dear {name}, flat {flat}: maintenance dues of {amount} ({months}) are pending at {society}. Please pay at the earliest. A late penalty may apply as per the society rules. Thank you.",
    notice: "Notice from {society}\n\nDear {name} (Flat {flat}),\n\n[Write the notice here: date, time and place]\n\nSecretary, {society}",
    greeting: "Dear {name}, {society} wishes you and your family a very happy [festival name]! May this occasion bring joy and prosperity to your home.",
    custom: "Dear {name}, ",
  },
  mr: {
    reminder: "प्रिय {name}, सदनिका {flat}: {society} ची देखभाल थकबाकी {amount} ({months}) बाकी आहे. कृपया लवकरात लवकर भरणा करावा. सोसायटीच्या नियमांनुसार विलंब दंड लागू होऊ शकतो. धन्यवाद.",
    notice: "{society} कडून सूचना\n\nप्रिय {name} (सदनिका {flat}),\n\n[येथे सूचना लिहा: तारीख, वेळ आणि ठिकाण]\n\nसचिव, {society}",
    greeting: "प्रिय {name}, {society} तर्फे आपल्या व आपल्या कुटुंबाला [सणाचे नाव] च्या हार्दिक शुभेच्छा! हा सण आपल्या घरात आनंद व समृद्धी घेऊन येवो.",
    custom: "प्रिय {name}, ",
  },
};
