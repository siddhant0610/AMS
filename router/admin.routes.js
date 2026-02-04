import express from "express";
import { migrateSubmissionsToUsers } from "../controller/migration.controller.js";

const router = express.Router();

// PROTECT THIS ROUTE! (Use your verifyJWT or Admin middleware)
router.post("/run-migration", migrateSubmissionsToUsers);

export default router;