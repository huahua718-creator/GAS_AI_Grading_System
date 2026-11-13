import { Redis } from "@upstash/redis";

// Lazy initialization for Redis client using auto-injected KV_REST_API_* or UPSTASH_REDIS_REST_* env vars
let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      throw new Error("Missing Upstash Redis environment variables (KV_REST_API_URL, KV_REST_API_TOKEN)");
    }

    _redis = new Redis({
      url,
      token,
    });
  }
  return _redis;
}

export interface ActiveStudent {
  studentId: string;
  studentName: string;
  fileId: string;
  fileType: string;
  fileName: string;
  companionDocId?: string | null;
  updatedAt: number;
}

export interface VoiceFeedbackItem {
  id: string;
  timestamp: number;
  transcription: string;
  keyPoints: string[];
  rewriteExample: string;
  studentId: string;
  studentName: string;
}

// TTL: 12 hours (43200 seconds)
const SESSION_TTL = 43200;

export async function setSessionActiveStudent(sessionId: string, student: ActiveStudent) {
  const redis = getRedis();
  const key = `session:${sessionId}:active_student`;
  await redis.set(key, JSON.stringify(student), { ex: SESSION_TTL });
}

export async function getSessionActiveStudent(sessionId: string): Promise<ActiveStudent | null> {
  const redis = getRedis();
  const key = `session:${sessionId}:active_student`;
  const raw = await redis.get(key);
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw as ActiveStudent;
}

export async function pushVoiceFeedback(sessionId: string, feedback: VoiceFeedbackItem) {
  const redis = getRedis();
  const listKey = `session:${sessionId}:voice_queue`;
  await redis.rpush(listKey, JSON.stringify(feedback));
  await redis.expire(listKey, SESSION_TTL);
}

export async function popVoiceFeedback(sessionId: string): Promise<VoiceFeedbackItem[]> {
  const redis = getRedis();
  const listKey = `session:${sessionId}:voice_queue`;
  // Get all items and clear queue in pipeline
  const items = await redis.lrange(listKey, 0, -1);
  if (!items || items.length === 0) return [];

  await redis.del(listKey);

  return items.map((item) => {
    if (typeof item === "string") {
      try {
        return JSON.parse(item);
      } catch {
        return null;
      }
    }
    return item;
  }).filter(Boolean) as VoiceFeedbackItem[];
}

