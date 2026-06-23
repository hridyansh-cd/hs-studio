import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, sessionsTable, timelineEventsTable, chatMessagesTable } from "@workspace/db";
import {
  CreateSessionBody,
  GetSessionParams,
  DeleteTimelineEventParams,
  ListSessionEventsParams,
  CreateTimelineEventParams,
  CreateTimelineEventBody,
  ListChatMessagesParams,
  SendChatMessageParams,
  SendChatMessageBody,
} from "@workspace/api-zod";

const router = Router();

router.get("/editor/sessions", async (_req, res): Promise<void> => {
  const sessions = await db.select().from(sessionsTable).orderBy(sessionsTable.createdAt);
  res.json(sessions);
});

router.post("/editor/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [session] = await db.insert(sessionsTable).values({ name: parsed.data.name }).returning();
  res.status(201).json(session);
});

router.get("/editor/sessions/:id", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const events = await db.select().from(timelineEventsTable).where(eq(timelineEventsTable.sessionId, params.data.id)).orderBy(timelineEventsTable.timestamp);
  const messages = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.sessionId, params.data.id)).orderBy(chatMessagesTable.createdAt);
  res.json({ ...session, events, messages });
});

router.get("/editor/sessions/:id/events", async (req, res): Promise<void> => {
  const params = ListSessionEventsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const events = await db.select().from(timelineEventsTable).where(eq(timelineEventsTable.sessionId, params.data.id)).orderBy(timelineEventsTable.timestamp);
  res.json(events);
});

router.post("/editor/sessions/:id/events", async (req, res): Promise<void> => {
  const params = CreateTimelineEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateTimelineEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [event] = await db.insert(timelineEventsTable).values({
    sessionId: params.data.id,
    type: parsed.data.type,
    timestamp: parsed.data.timestamp,
    duration: parsed.data.duration ?? null,
    label: parsed.data.label ?? null,
  }).returning();
  res.status(201).json(event);
});

router.delete("/editor/sessions/:id/events/:eventId", async (req, res): Promise<void> => {
  const params = DeleteTimelineEventParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(timelineEventsTable).where(eq(timelineEventsTable.id, params.data.eventId)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/editor/sessions/:id/chat", async (req, res): Promise<void> => {
  const params = ListChatMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const messages = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.sessionId, params.data.id)).orderBy(chatMessagesTable.createdAt);
  res.json(messages);
});

const COMMAND_COST = 5;

function detectCommand(content: string): "cut" | "subtitle" | "zoom" | null {
  const lower = content.toLowerCase();
  if (lower.includes("cut")) return "cut";
  if (lower.includes("subtitle") || lower.includes("caption")) return "subtitle";
  if (lower.includes("zoom")) return "zoom";
  return null;
}

function buildMockResponse(command: "cut" | "subtitle" | "zoom" | null, timestamp: number): string {
  if (command === "cut") {
    return `✂️ Cut applied at ${timestamp.toFixed(1)}s. The clip has been split at this point on the timeline. You can drag the cut point to adjust timing.`;
  }
  if (command === "subtitle") {
    return `💬 Subtitle added at ${timestamp.toFixed(1)}s with a 3-second duration. Double-click the subtitle marker on the timeline to edit the text.`;
  }
  if (command === "zoom") {
    return `🔍 Zoom effect added at ${timestamp.toFixed(1)}s (1.5× scale, 2s duration). The zoom will ease in and out smoothly. Adjust intensity in the timeline panel.`;
  }
  return `I can help you edit your video! Try commands like:\n• **cut** — split the clip at the current position\n• **subtitle** — add a subtitle at the current time\n• **zoom** — add a zoom-in effect at the current position`;
}

router.post("/editor/sessions/:id/chat", async (req, res): Promise<void> => {
  const params = SendChatMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = SendChatMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, params.data.id));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const command = detectCommand(parsed.data.content);
  const currentTimestamp = parsed.data.currentTimestamp;

  const [userMsg] = await db.insert(chatMessagesTable).values({
    sessionId: params.data.id,
    role: "user",
    content: parsed.data.content,
    command: null,
  }).returning();

  let timelineEvent = null;
  let creditsRemaining = session.credits;

  if (command && session.credits >= COMMAND_COST) {
    const subtitleText = command === "subtitle"
      ? (parsed.data.content.replace(/subtitle|add|at|caption|here/gi, "").trim() || "Subtitle text here")
      : null;

    const [evt] = await db.insert(timelineEventsTable).values({
      sessionId: params.data.id,
      type: command,
      timestamp: currentTimestamp,
      duration: command === "cut" ? null : command === "zoom" ? 2 : 3,
      label: command === "subtitle" ? subtitleText : command === "zoom" ? "1.5× zoom" : null,
    }).returning();
    timelineEvent = evt;

    const [updatedSession] = await db.update(sessionsTable)
      .set({ credits: session.credits - COMMAND_COST })
      .where(eq(sessionsTable.id, params.data.id))
      .returning();
    creditsRemaining = updatedSession.credits;
  }

  const responseText = buildMockResponse(command, currentTimestamp);
  const [assistantMsg] = await db.insert(chatMessagesTable).values({
    sessionId: params.data.id,
    role: "assistant",
    content: responseText,
    command,
  }).returning();

  res.json({
    message: userMsg,
    assistantMessage: assistantMsg,
    timelineEvent,
    creditsRemaining,
  });
});

export default router;
