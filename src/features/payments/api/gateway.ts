import { config } from '@/shared/config/env';
import type { PaymentGateway } from '../domain/types';
import { MockGateway } from './mock/mockGateway';
import { WsGateway } from './s2s/wsGateway';

const wsGateway = config.paymentMode === 's2s' ? new WsGateway(config.wsUrl) : null;
// Open it now rather than on the first sale, so a dead server is visible early.
wsGateway?.connect();

export const gateway: PaymentGateway = wsGateway ?? new MockGateway();

/** Only the mock has no physical Spot, so only it lets the screen fake the tap. */
export const demoGateway = gateway instanceof MockGateway ? gateway : null;

/** The server link to watch; null in demo mode, which has none. */
export const connection = wsGateway;
