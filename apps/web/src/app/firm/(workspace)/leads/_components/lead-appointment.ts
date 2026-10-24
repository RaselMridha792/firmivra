import { ApiRequestError } from '@firmivra/types';
import { errorMessage } from '../../../../../lib/errors';

/**
 * Why a booking failed: the server's own reason when no field is at fault (a lead that is not a
 * client yet, L12), so the dialog never says "check the highlighted fields" with none highlighted.
 */
export const scheduleErrorText = (error: unknown): string =>
  error instanceof ApiRequestError && error.code === 'VALIDATION_FAILED' && !error.details?.length
    ? error.message
    : errorMessage(error);
