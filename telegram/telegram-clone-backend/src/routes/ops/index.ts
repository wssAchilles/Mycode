import { Router } from 'express';
import chatDeliveryRoutes from './chatDelivery';
import controlPlaneRoutes from './controlPlane';
import platformBusRoutes from './platformBus';
import realtimeRoutes from './realtime';
import recommendationRoutes from './recommendation';
import runtimeRoutes from './runtime';

const router = Router();

router.use(chatDeliveryRoutes);
router.use(controlPlaneRoutes);
router.use(realtimeRoutes);
router.use(platformBusRoutes);
router.use(recommendationRoutes);
router.use(runtimeRoutes);

export default router;
