import { Chart } from '@bloxwap/chart/react';
import type { Candle } from '@bloxwap/chart';

export function PriceChart({ data }: { data: Candle[] }) {
  return <Chart data={data} theme="dark" height={360} />;
}
