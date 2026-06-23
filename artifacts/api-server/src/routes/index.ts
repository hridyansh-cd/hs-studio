import { Router, type IRouter } from "express";
import healthRouter from "./health";
import editorRouter from "./editor/sessions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(editorRouter);

export default router;
