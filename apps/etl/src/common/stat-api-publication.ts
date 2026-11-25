import type { PoolClient } from 'pg';

export type StatApiReference = {
  datasetId: string;
  serviceName: string;
  scope: 'SEOUL';
};

export type StatApiSource<Row> = {
  reference: StatApiReference;
  load: (onRows: (rows: Row[]) => Promise<void>) => Promise<{
    checksum: string;
    fetchedRows: number;
    validRows: number;
    rejectedRows: 0;
    periodFrom: string;
    periodTo: string;
    reference: StatApiReference & { checksumFormat: string };
  }>;
  verifyIndustries: (client: PoolClient) => Promise<void>;
};
