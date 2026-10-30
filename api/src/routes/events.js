import { Router } from 'express';
import { openStream } from '../lib/realtime.js';

export const eventsRouter = Router();

/** GET /api/events: a long-lived stream of change notifications for the caller's workspace. */
eventsRouter.get('/', (req, res) => openStream(req, res));
