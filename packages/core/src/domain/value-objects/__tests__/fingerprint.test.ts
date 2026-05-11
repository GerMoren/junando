import { describe, it, expect } from 'vitest';
import { Fingerprint } from '../fingerprint.js';
import type { NormalizedAlert } from '../../entities/alert.js';
import { AlertType } from '../../../shared/constants';

describe('Fingerprint Value Object', () => {
  it('generates deterministic hash regardless of case or whitespace', () => {
    const alert1: NormalizedAlert = {
      alertName: 'HighErrorRate',
      serviceName: 'Auth-Service ',
      alertType: AlertType.Error,
      endpointPath: '/api/v1/login',
      status: 'firing',
      startsAt: new Date().toISOString(),
      labels: {},
      annotations: {},
    };

    const alert2: NormalizedAlert = {
      ...alert1,
      serviceName: 'auth-service',
      alertType: AlertType.Error,
      endpointPath: ' /api/v1/login ',
    };

    const fp1 = Fingerprint.fromAlert(alert1);
    const fp2 = Fingerprint.fromAlert(alert2);

    expect(fp1.value).toBe(fp2.value);
    expect(fp1.equals(fp2)).toBe(true);
  });

  it('generates different hashes for different alerts', () => {
    const alert1: NormalizedAlert = {
      alertName: 'HighErrorRate',
      serviceName: 'auth-service',
      alertType: AlertType.Error,
      endpointPath: '/login',
      status: 'firing',
      startsAt: new Date().toISOString(),
      labels: {},
      annotations: {},
    };

    const alert2: NormalizedAlert = {
      ...alert1,
      alertType: AlertType.Warning,
      endpointPath: '/register',
    };

    const fp1 = Fingerprint.fromAlert(alert1);
    const fp2 = Fingerprint.fromAlert(alert2);

    expect(fp1.value).not.toBe(fp2.value);
    expect(fp1.equals(fp2)).toBe(false);
  });
});
