/**
 * WhatsApp AI Auto-Reply Service
 *
 * When an inbound WhatsApp message arrives and the voice agent is not active,
 * this service generates an AI-powered response using the configured LLM provider.
 * The reply is sent back via the WhatsApp Business Cloud API.
 */

import { env } from "./env";
import { sendTwilioWhatsApp } from "@/server/integrations/twilio-whatsapp";

interface AIReplyResult {
  success: boolean;
  reply?: string;
  error?: string;
}

/**
 * Generate an AI reply for an incoming WhatsApp message using the configured LLM.
 */
export async function generateAIReply(
  conversationHistory: { role: "user" | "assistant" | "system"; content: string }[],
): Promise<AIReplyResult> {
  const { provider, groqApiKey, groqModel, googleApiKey, openaiApiKey } = env.llm;

  const systemMessage = {
    role: "system" as const,
    content: `You are a helpful AI assistant for Autoneural, a company providing AI agents, AI calling systems, WhatsApp automation, websites, custom software and business automation.
You reply to WhatsApp messages from customers and businesses seeking help with their projects.
Be warm, professional, and concise. Keep replies under 300 characters for WhatsApp readability.
Never invent prices, customers, results, appointments, or capabilities. Gather their name, company and requirements and offer a team callback when information is unavailable.
Speak in English by default; switch to Hindi if they write in Hindi.`,
  };

  const messages = [systemMessage, ...conversationHistory];

  try {
    if (provider === "groq" && groqApiKey) {
      return await callGroqAPI(messages, groqApiKey, groqModel);
    }
    if (provider === "google" && googleApiKey) {
      return await callGeminiAPI(messages, googleApiKey);
    }
    if (provider === "openai" && openaiApiKey) {
      return await callOpenAIAPI(messages, openaiApiKey);
    }

    return { success: false, error: "No LLM provider configured" };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

async function callGroqAPI(
  messages: { role: string; content: string }[],
  apiKey: string,
  model: string,
): Promise<AIReplyResult> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 300,
      temperature: 0.7,
    }),
  });

  const data = await response.json();
  if (data.choices?.[0]?.message?.content) {
    return { success: true, reply: data.choices[0].message.content };
  }
  return { success: false, error: JSON.stringify(data.error ?? "No response") };
}

async function callGeminiAPI(
  messages: { role: string; content: string }[],
  apiKey: string,
): Promise<AIReplyResult> {
  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Convert OpenAI-style messages to Gemini format
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const systemInstruction = messages.find((m) => m.role === "system");

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction.content }] } } : {}),
      generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
    }),
  });

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text) {
    return { success: true, reply: text };
  }
  return { success: false, error: JSON.stringify(data.error ?? "No response") };
}

async function callOpenAIAPI(
  messages: { role: string; content: string }[],
  apiKey: string,
): Promise<AIReplyResult> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages,
      max_tokens: 300,
      temperature: 0.7,
    }),
  });

  const data = await response.json();
  if (data.choices?.[0]?.message?.content) {
    return { success: true, reply: data.choices[0].message.content };
  }
  return { success: false, error: JSON.stringify(data.error ?? "No response") };
}

/**
 * Send a WhatsApp message via the configured provider (Twilio or Meta Cloud API).
 */
export async function sendWhatsAppMessage(
  to: string,
  text: string,
): Promise<{ sent: boolean; messageId?: string; error?: string }> {
  if (env.demoMode) {
    return { sent: true, messageId: `demo-wa-ai-${Date.now()}` };
  }

  if (env.whatsappProvider === "twilio") {
    const r = await sendTwilioWhatsApp(to, text);
    return { sent: r.accepted, messageId: r.providerMessageId ?? undefined, error: r.error ?? undefined };
  }

  const { accessToken, phoneNumberId, apiVersion } = env.whatsapp;
  if (!accessToken || !phoneNumberId) {
    return { sent: false, error: "WhatsApp not configured" };
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: to.replace(/[^0-9]/g, ""),
          type: "text",
          text: { body: text },
        }),
      },
    );

    const data = await response.json();
    if (data.messages?.[0]?.id) {
      return { sent: true, messageId: data.messages[0].id };
    }
    return { sent: false, error: JSON.stringify(data.error ?? "Send failed") };
  } catch (e: any) {
    return { sent: false, error: e.message };
  }
}
