import { Router, type IRouter } from "express";
import healthRouter from "./health";
import editorRouter from "./editor/sessions";
import transcribeRouter from "./editor/transcribe";
import exportRouter from "./editor/export";
import chatRouter from "./editor/chat";
import analyzeFrameRouter from "./editor/analyzeFrame";

const router: IRouter = Router();

router.use(healthRouter);
router.use(editorRouter);
router.use(transcribeRouter);
router.use(exportRouter);
router.use(chatRouter);
router.use(analyzeFrameRouter);

export default router;
