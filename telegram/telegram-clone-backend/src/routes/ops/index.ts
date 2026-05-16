import { Router } from 'express';
import chatDeliveryRoutes from './chatDelivery';
import controlPlaneRoutes from './controlPlane';
import platformBusRoutes from './platformBus';
import realtimeRoutes from './realtime';
import recommendationRoutes from './recommendation';

const router = Router();

router.use(chatDeliveryRoutes);
router.use(controlPlaneRoutes);
router.use(realtimeRoutes);
router.use(platformBusRoutes);
router.use(recommendationRoutes);

export default router;
