import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workflowsRouter from "./workflows";
import nodesRouter from "./nodes";
import executionsRouter from "./executions";
import variablesRouter from "./variables";
import credentialsRouter from "./credentials";
import packagesRouter from "./packages";
import databaseRouter from "./database";

const router: IRouter = Router();

router.use(healthRouter);
router.use(workflowsRouter);
router.use(nodesRouter);
router.use(executionsRouter);
router.use(variablesRouter);
router.use(credentialsRouter);
router.use(packagesRouter);
router.use(databaseRouter);

export default router;
