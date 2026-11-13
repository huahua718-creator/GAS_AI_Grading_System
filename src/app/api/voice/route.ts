import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

// Response JSON schema for voice processing
const VOICE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    transcription: {
      type: "string",
      description: "口述語音的完整逐字稿",
    },
    keyPoints: {
      type: "array",
      items: { type: "string" },
      description: "1 到 2 句重點摘要 (Bullet Points)",
    },
    rewriteExample: {
      type: "string",
      description: "針對問題段落或弱項，提供一段專業、優雅、精準的示範重寫範例",
    },
  },
  required: ["transcription", "keyPoints", "rewriteExample"],
};

export async function POST(req: Request) {
  try {
    // 1. Extract API Key (Strict BYOK: Header > Request Body > Env)
    const authHeader = req.headers.get("x-gemini-api-key") || req.headers.get("authorization")?.replace("Bearer ", "");
    const body = await req.json();
    const apiKey = authHeader || body.apiKey || process.env.GEMINI_API_KEY;

    if (!apiKey || !apiKey.trim()) {
      return NextResponse.json(
        { error: "未提供 Gemini API Key。請在設定中填入您在 Google AI Studio 申請的金鑰 (BYOK)" },
        { status: 401 }
      );
    }

    const { audioBase64, mimeType = "audio/webm", selectedText } = body;

    if (!audioBase64) {
      return NextResponse.json({ error: "未接收到音訊資料 (audioBase64 is required)" }, { status: 400 });
    }

    // 2. Initialize official @google/genai SDK with the teacher's BYOK key
    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });

    const promptText =
      "你是一位專業高中與大學資深教師教學助手。以下是教師在手機上錄製的口述批註語音。\n" +
      "請執行以下任務：\n" +
      "1. 準確辨識口述語音內容。\n" +
      "2. 提煉為 1~2 句重點摘要 (Bullet Points)。\n" +
      "3. 針對學生待改進之處，提供一段專業、優雅、精準的示範重寫範例。\n" +
      (selectedText ? `【教師選定之學生原文段落】：\n${selectedText}\n` : "");

    // 3. Call Gemini 3.8 Flash via Interactions API
    const interaction = await ai.interactions.create({
      model: "gemini-3.8-flash",
      input: [
        {
          type: "text",
          text: promptText,
        },
        {
          type: "audio",
          data: audioBase64,
          mime_type: mimeType,
        },
      ],
      response_format: VOICE_RESPONSE_SCHEMA,
    });

    const rawOutput = interaction.output_text;
    if (!rawOutput) {
      throw new Error("Gemini API 未回傳有效文字");
    }

    let parsedResult;
    try {
      parsedResult = JSON.parse(rawOutput);
    } catch {
      const cleaned = rawOutput.replace(/```json/g, "").replace(/```/g, "").trim();
      parsedResult = JSON.parse(cleaned);
    }

    return NextResponse.json({
      success: true,
      transcription: parsedResult.transcription || "",
      keyPoints: parsedResult.keyPoints || [],
      rewriteExample: parsedResult.rewriteExample || "",
    });
  } catch (err: any) {
    console.error("Voice processing error:", err);
    return NextResponse.json(
      { error: err.message || "語音處理失敗" },
      { status: 500 }
    );
  }
}

