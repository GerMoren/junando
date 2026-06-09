import { describe, it, expect } from 'vitest';
import {
  isCsvBody,
  parseCsvBody,
  generateFingerprint,
  DEFAULT_CSV_COLUMN_MAPPING,
  type CsvColumnMapping,
} from '../csv-input.adapter';
import { AlertType } from '@junando/core';

describe('csv-input.adapter', () => {
  // ── isCsvBody ──────────────────────────────────────────────────────────────

  describe('isCsvBody', () => {
    it('returns true for comma-separated text with newlines', () => {
      const csv = 'service,message,severity,time\nsvc-api,high error rate,error,2024-01-01T00:00:00Z';
      expect(isCsvBody(csv)).toBe(true);
    });

    it('returns true for single-row CSV with many columns', () => {
      const csv = 'svc-api,high error rate,error,2024-01-01T00:00:00Z';
      expect(isCsvBody(csv)).toBe(true);
    });

    it('returns false for JSON object', () => {
      expect(isCsvBody('{"correlationId":"..."}')).toBe(false);
    });

    it('returns false for JSON array', () => {
      expect(isCsvBody('[{"a":"b"}]')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isCsvBody('')).toBe(false);
      expect(isCsvBody('   ')).toBe(false);
    });

    it('returns false for plain text without commas', () => {
      expect(isCsvBody('just some text\nwith newlines')).toBe(false);
    });
  });

  // ── generateFingerprint ────────────────────────────────────────────────────

  describe('generateFingerprint', () => {
    it('generates consistent hash for same input', () => {
      const fp1 = generateFingerprint('api-service', 'high error rate');
      const fp2 = generateFingerprint('api-service', 'high error rate');
      expect(fp1).toBe(fp2);
    });

    it('generates different hash for different input', () => {
      const fp1 = generateFingerprint('api-service', 'high error rate');
      const fp2 = generateFingerprint('api-service', 'timeout error');
      expect(fp1).not.toBe(fp2);
    });

    it('starts with csv- prefix', () => {
      const fp = generateFingerprint('svc', 'msg');
      expect(fp).toMatch(/^csv-[0-9a-f]{8}$/);
    });
  });

  // ── parseCsvBody ────────────────────────────────────────────────────────────

  describe('parseCsvBody', () => {
    it('parses well-formed CSV with default mapping (index-based)', () => {
      const csv = `service,message,severity,timestamp
api-gateway,Connection timeout to db,error,2024-06-09T10:00:00Z
auth-service,High latency detected,warning,2024-06-09T10:01:00Z`;

      const result = parseCsvBody(csv);
      expect(result).not.toBeNull();
      expect(result!.alerts).toHaveLength(2);
      expect(result!.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );

      const [alert1, alert2] = result!.alerts;
      expect(alert1.serviceName).toBe('api-gateway');
      expect(alert1.alertName).toBe('Connection timeout to db');
      expect(alert1.alertType).toBe(AlertType.Error);
      expect(alert1.fingerprint).toMatch(/^csv-/);

      expect(alert2.serviceName).toBe('auth-service');
      expect(alert2.alertType).toBe(AlertType.Warning);
    });

    it('parses CSV with header names (string-based mapping)', () => {
      const csv = `svc,msg,sev,ts
api-gateway,Error alert,critical,2024-06-09T10:00:00Z`;

      const mapping: CsvColumnMapping = {
        serviceCol: 'svc',
        messageCol: 'msg',
        severityCol: 'sev',
        timestampCol: 'ts',
        extraLabels: 'env=prod', // Static extra labels, not from CSV column
      };

      const result = parseCsvBody(csv, mapping);
      expect(result).not.toBeNull();
      expect(result!.alerts).toHaveLength(1);
      expect(result!.alerts[0].serviceName).toBe('api-gateway');
      expect(result!.alerts[0].labels.env).toBe('prod');
    });

    it('returns null for CSV with fewer than 2 rows (no data)', () => {
      const csv = `service,message,severity,timestamp`;
      expect(parseCsvBody(csv)).toBeNull();
    });

    it('skips rows with missing required fields', () => {
      const csv = `service,message,severity,timestamp
api-gateway,Error alert,error,2024-06-09T10:00:00Z
,Missing service,,`;
      const result = parseCsvBody(csv);
      expect(result).not.toBeNull();
      expect(result!.alerts).toHaveLength(1); // Only first row valid
    });

    it('skips rows with unrecognised severity', () => {
      const csv = `service,message,severity,timestamp
api-gateway,Unknown sev,unknown_severity,2024-06-09T10:00:00Z`;
      expect(parseCsvBody(csv)).toBeNull(); // No valid alerts
    });

    it('parses Unix timestamp (seconds)', () => {
      const unixSeconds = Math.floor(Date.now() / 1000);
      const csv = `service,message,severity,timestamp
api-gateway,Error alert,error,${unixSeconds}`;

      const result = parseCsvBody(csv);
      expect(result).not.toBeNull();
      expect(result!.alerts[0].startsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('respects custom fingerprint column', () => {
      const csv = `service,message,severity,timestamp,fp
api-gateway,Error alert,error,2024-06-09T10:00:00Z,my-custom-fingerprint`;

      const mapping: CsvColumnMapping = {
        serviceCol: 0,
        messageCol: 1,
        severityCol: 2,
        timestampCol: 3,
        fingerprintCol: 4,
      };

      const result = parseCsvBody(csv, mapping);
      expect(result!.alerts[0].fingerprint).toBe('my-custom-fingerprint');
    });

    it('handles quoted fields with commas inside', () => {
      const csv = `service,message,severity,timestamp
api-gateway,"Error: connection failed, timeout after 30s",error,2024-06-09T10:00:00Z`;

      const result = parseCsvBody(csv);
      expect(result).not.toBeNull();
      expect(result!.alerts[0].alertName).toBe('Error: connection failed, timeout after 30s');
    });

    it('returns null when no rows produce valid alerts', () => {
      const csv = `service,message,severity,timestamp
,missing service,error,2024-06-09T10:00:00Z
api-gateway,,error,2024-06-09T10:00:00Z
api-gateway,msg,invalid_severity,2024-06-09T10:00:00Z`;

      expect(parseCsvBody(csv)).toBeNull();
    });

    it('maps all severity variants correctly', () => {
      const severities = ['error', 'critical', 'high', 'warning', 'warn', 'latency', 'success', 'recovery', 'resolved', 'info'];

      for (const sev of severities) {
        const csv = `service,message,severity,timestamp
svc,msg,${sev},2024-06-09T10:00:00Z`;

        const result = parseCsvBody(csv);
        expect(result?.alerts[0].alertType).toBeDefined();
      }
    });
  });
});