import { config } from '@/shared/config/env';
import type { PaymentGateway } from '../domain/types';
import { MockGateway } from './mock/mockGateway';
import { MachineChannel } from './s2s/machineChannel';
import { createPaymentsApi } from './s2s/paymentsApi';
import { S2sGateway } from './s2s/s2sGateway';

const channel = config.paymentMode === 's2s' ? new MachineChannel(config.wsUrl) : null;
// Open it now rather than on the first sale, so a dead server is visible early.
channel?.connect();

export const gateway: PaymentGateway = channel
  ? new S2sGateway(createPaymentsApi(config.apiUrl), channel, { pollMs: config.pollMs })
  : new MockGateway();

/** Only the mock has no physical Spot, so only it lets the screen fake the tap. */
export const demoGateway = gateway instanceof MockGateway ? gateway : null;

/** The machine channel to watch; null in demo mode, which has none. */
export const connection = channel;
