import { NextResponse } from "next/server";
import {
  setSessionActiveStudent,
  getSessionActiveStudent,
  pushVoiceFeedback,
  popVoiceFeedback,
  ActiveStudent,
  VoiceFeedbackItem,
} from "@/lib/redis";

// GET /api/session?id=SESSION_ID&action=poll
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("id");
    const action = searchParams.get("action"); // 'active' | 'feedback' | 'all'

    if (!sessionId) {
      return NextResponse.json({ error: "Missing session id" }, { status: 400 });
    }

    const activeStudent = await getSessionActiveStudent(sessionId);

    // If PC sidebar asks for new pending voice feedback, pop queue items
    let pendingVoiceFeedback: VoiceFeedbackItem[] = [];
    if (action === "feedback" || action === "all" || !action) {
      pendingVoiceFeedback = await popVoiceFeedback(sessionId);
    }

    return NextResponse.json({
      success: true,
      sessionId,
      activeStudent,
      newFeedback: pendingVoiceFeedback,
    });
  } catch (err: any) {
    console.error("GET /api/session error:", err);
    return NextResponse.json({ error: err.message || "Session query failed" }, { status: 500 });
  }
}

// POST /api/session
// Body: { sessionId, activeStudent?, voiceFeedback? }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { sessionId, activeStudent, voiceFeedback } = body;

    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    if (activeStudent) {
      const studentData: ActiveStudent = {
        studentId: activeStudent.studentId,
        studentName: activeStudent.studentName,
        fileId: activeStudent.fileId,
        fileType: activeStudent.fileType || "DOC",
        fileName: activeStudent.fileName || "作業文件",
        companionDocId: activeStudent.companionDocId || null,
        updatedAt: Date.now(),
      };
      await setSessionActiveStudent(sessionId, studentData);
    }

    if (voiceFeedback) {
      const feedbackItem: VoiceFeedbackItem = {
        id: `voice_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: Date.now(),
        transcription: voiceFeedback.transcription,
        keyPoints: voiceFeedback.keyPoints || [],
        rewriteExample: voiceFeedback.rewriteExample || "",
        studentId: voiceFeedback.studentId || "",
        studentName: voiceFeedback.studentName || "",
      };
      await pushVoiceFeedback(sessionId, feedbackItem);
    }

    return NextResponse.json({ success: true, sessionId });
  } catch (err: any) {
    console.error("POST /api/session error:", err);
    return NextResponse.json({ error: err.message || "Failed to update session" }, { status: 500 });
  }
}

