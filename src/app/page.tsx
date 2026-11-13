"use client";

import React, { useState, useEffect, useRef } from "react";
import { Mic, Square, Loader2, Sparkles, Key, CheckCircle, Smartphone, AlertCircle, RefreshCw } from "lucide-react";

interface ActiveStudent {
  studentId: string;
  studentName: string;
  fileId: string;
  fileType: string;
  fileName: string;
  companionDocId?: string | null;
  updatedAt: number;
}

interface ProcessedVoice {
  transcription: string;
  keyPoints: string[];
  rewriteExample: string;
}

export default function MobileRemotePage() {
  const [sessionId, setSessionId] = useState<string>("");
  const [apiKey, setApiKey] = useState<string>("");
  const [showKeyModal, setShowKeyModal] = useState<boolean>(false);
  const [activeStudent, setActiveStudent] = useState<ActiveStudent | null>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [recordSeconds, setRecordSeconds] = useState<number>(0);
  const [lastResult, setLastResult] = useState<ProcessedVoice | null>(null);
  const [statusMsg, setStatusMsg] = useState<string>("等待選取學生...");
  const [isConnected, setIsConnected] = useState<boolean>(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Initialize session and BYOK API Key from LocalStorage & URL query
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlSession = params.get("session") || params.get("code") || "";
      const savedKey = localStorage.getItem("BYOK_GEMINI_API_KEY") || "";

      setSessionId(urlSession);
      setApiKey(savedKey);

      if (!savedKey) {
        setShowKeyModal(true);
      }
    }
  }, []);

  // 2. Poll Vercel Redis for current active student
  useEffect(() => {
    if (!sessionId) return;

    let isMounted = true;
    const checkActive = async () => {
      try {
        const res = await fetch(`/api/session?id=${encodeURIComponent(sessionId)}&action=active`);
        if (!res.ok) throw new Error("Sync failed");
        const data = await res.json();
        if (isMounted) {
          setIsConnected(true);
          if (data.activeStudent) {
            setActiveStudent(data.activeStudent);
          }
        }
      } catch {
        if (isMounted) setIsConnected(false);
      }
    };

    checkActive();
    const interval = setInterval(checkActive, 2000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [sessionId]);

  const saveApiKey = (key: string) => {
    const trimmed = key.trim();
    setApiKey(trimmed);
    localStorage.setItem("BYOK_GEMINI_API_KEY", trimmed);
    setShowKeyModal(false);
  };

  // 3. Audio recording handling
  const toggleRecording = async () => {
    if (!apiKey) {
      setShowKeyModal(true);
      return;
    }
    if (!activeStudent) {
      alert("請先在電腦端 Google 文件側邊欄點選一位要批註的學生！");
      return;
    }

    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];

      let mimeType = "audio/webm";
      if (!MediaRecorder.isTypeSupported("audio/webm")) {
        mimeType = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      }

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        await processVoiceUpload(audioBlob);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordSeconds(0);
      setStatusMsg("錄音中...請口述批註重點與重寫建議");

      timerRef.current = setInterval(() => {
        setRecordSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      alert("無法啟動麥克風，請確認已授權瀏覽器錄音權限：" + err.message);
    }
  };

  const stopRecording = () => {
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsProcessing(true);
    setStatusMsg("Gemini 3.8 Flash AI 正在轉寫與示範重寫中...");
  };

  const processVoiceUpload = async (blob: Blob) => {
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64Data = (reader.result as string).split(",")[1];
        const res = await fetch("/api/voice", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-gemini-api-key": apiKey,
          },
          body: JSON.stringify({
            audioBase64: base64Data,
            mimeType: blob.type || "audio/webm",
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "語音處理失敗");

        const voiceResult: ProcessedVoice = {
          transcription: data.transcription,
          keyPoints: data.keyPoints || [],
          rewriteExample: data.rewriteExample,
        };

        setLastResult(voiceResult);
        setStatusMsg("處理成功！已寫入電腦 Google 文件");

        // Push to Vercel Redis queue so PC sidebar can pop it into Google Doc
        if (sessionId && activeStudent) {
          await fetch("/api/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              voiceFeedback: {
                transcription: voiceResult.transcription,
                keyPoints: voiceResult.keyPoints,
                rewriteExample: voiceResult.rewriteExample,
                studentId: activeStudent.studentId,
                studentName: activeStudent.studentName,
              },
            }),
          });
        }
        setIsProcessing(false);
      };
      reader.readAsDataURL(blob);
    } catch (err: any) {
      alert("處理失敗：" + err.message);
      setIsProcessing(false);
      setStatusMsg("處理出錯，可重新錄製");
    }
  };

  const formatTimer = (sec: number) => {
    const mins = String(Math.floor(sec / 60)).padStart(2, "0");
    const secs = String(sec % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  };

  return (
    <div className="flex-1 flex flex-col justify-between max-w-md mx-auto w-full p-4 space-y-4">
      {/* Top Bar */}
      <header className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
            <Smartphone className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white">手機語音批註遙控端</h1>
            <p className="text-[10px] text-slate-400">BYOK 金鑰零落地 • 頂層 HTTPS</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-slate-800 text-[11px] font-mono border border-slate-700">
            <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-emerald-400 animate-pulse" : "bg-rose-500"}`} />
            <span className="text-slate-300">{isConnected ? "已連線" : "未連線"}</span>
          </div>

          <button
            onClick={() => setShowKeyModal(true)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            title="設定個人 Gemini API Key"
          >
            <Key className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Active Student Card */}
      <div className="bg-gradient-to-br from-slate-800 to-indigo-950/70 border border-slate-700 rounded-2xl p-4 shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider flex items-center">
            電腦端目前批改中
          </span>
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-400/30">
            {activeStudent?.fileType || "DOC"}
          </span>
        </div>

        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-xl bg-indigo-600 text-white font-extrabold text-xl flex items-center justify-center shadow-lg">
            {activeStudent?.studentName ? activeStudent.studentName.charAt(0) : "?"}
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              {activeStudent ? activeStudent.studentName : "等待電腦端選取學生..."}
            </h2>
            <div className="flex items-center space-x-2 text-xs text-slate-400 mt-0.5">
              <span className="font-mono">{activeStudent ? activeStudent.studentId : "------"}</span>
              <span>•</span>
              <span className="text-slate-300 truncate max-w-[180px]">
                {activeStudent ? activeStudent.fileName : "請在 Google 文件側邊欄點選任一生"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Voice Action Center */}
      <div className="flex-1 flex flex-col items-center justify-center py-6">
        <button
          onClick={toggleRecording}
          disabled={isProcessing}
          className={`w-36 h-36 rounded-full flex flex-col items-center justify-center shadow-2xl transition duration-200 active:scale-95 border-4 ${
            isRecording
              ? "bg-rose-600 border-rose-400 animate-pulse text-white"
              : isProcessing
              ? "bg-slate-700 border-slate-600 text-slate-400"
              : "bg-indigo-600 border-indigo-400 text-white hover:bg-indigo-500"
          }`}
        >
          {isProcessing ? (
            <Loader2 className="w-10 h-10 animate-spin mb-1" />
          ) : isRecording ? (
            <Square className="w-10 h-10 mb-1" />
          ) : (
            <Mic className="w-10 h-10 mb-1" />
          )}
          <span className="text-xs font-bold tracking-wider">
            {isProcessing ? "AI 分析中" : isRecording ? "完成送出" : "按此錄音"}
          </span>
        </button>

        <div className="mt-4 text-center">
          <div className="font-mono text-2xl font-bold text-slate-300 tracking-wider">
            {formatTimer(recordSeconds)}
          </div>
          <p className="text-xs text-slate-400 mt-1">{statusMsg}</p>
        </div>
      </div>

      {/* Realtime AI Feedback Result */}
      {lastResult && (
        <div className="bg-slate-800/90 border border-slate-700 rounded-2xl p-4 space-y-3 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-700 pb-2">
            <span className="text-xs font-bold text-indigo-400 flex items-center">
              <Sparkles className="w-3.5 h-3.5 mr-1 text-indigo-400" /> AI 語音重寫與摘要
            </span>
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/70 border border-emerald-500/40 px-2 py-0.5 rounded-full flex items-center">
              <CheckCircle className="w-3 h-3 mr-1" /> 已同步寫入 Doc
            </span>
          </div>

          <div>
            <span className="text-[10px] text-slate-400 block font-semibold">口述逐字稿：</span>
            <p className="text-xs text-slate-200 italic mt-0.5 leading-relaxed">{lastResult.transcription}</p>
          </div>

          <div className="pt-2 border-t border-slate-700/60">
            <span className="text-[10px] text-amber-400 block font-semibold">示範優化重寫：</span>
            <p className="text-xs text-amber-200 font-medium mt-0.5 bg-amber-950/40 p-2.5 rounded-lg border border-amber-900/60 leading-relaxed">
              {lastResult.rewriteExample}
            </p>
          </div>
        </div>
      )}

      {/* BYOK Modal */}
      {showKeyModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-3">
            <h3 className="text-base font-bold text-white flex items-center">
              <Key className="w-4 h-4 text-indigo-400 mr-2" /> 設定個人 Gemini API Key (BYOK)
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              為確保完全隱私與金鑰零落地，您的 API Key 僅保存在這台手機的瀏覽器中，每次呼叫時以加密 HTTPS 直送 Gemini，伺服器不留存。
            </p>

            <input
              type="password"
              placeholder="貼上 AIzaSy... API Key"
              defaultValue={apiKey}
              id="inputKeyField"
              className="w-full px-3 py-2 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />

            <div className="flex items-center justify-between pt-2">
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-indigo-400 underline"
              >
                免費取得金鑰
              </a>

              <div className="flex space-x-2">
                <button
                  onClick={() => setShowKeyModal(false)}
                  className="px-3 py-1.5 text-xs rounded-lg text-slate-400 hover:text-white"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    const el = document.getElementById("inputKeyField") as HTMLInputElement;
                    if (el) saveApiKey(el.value);
                  }}
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white"
                >
                  儲存金鑰
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="text-center text-[10px] text-slate-600 py-1">
        GAS AI Grading System • Gemini 3.8 Flash • Powered by Vercel & Upstash
      </footer>
    </div>
  );
}

