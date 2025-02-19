import { formatDate } from "./intervalFunctions";

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  interval: string;
  currentTitle: string;
  previousTitle: string;
  differenceTitle: string;
}

export const CustomTooltip = ({
  active,
  payload,
  label,
  interval,
  currentTitle,
  previousTitle,
  differenceTitle,
}: CustomTooltipProps) => {
  if (!active || !payload || !payload.length || !label) return null;

  const currentRevenue = payload[0]?.value;
  const previousRevenue = payload[1]?.value;
  const difference = currentRevenue - previousRevenue;
  const percentChange = ((difference / previousRevenue) * 100).toFixed(2);
  const isPositive = difference > 0;

  return (
    <div className="bg-background border rounded-lg p-2 shadow-lg">
      <p className="font-semibold">{formatDate(label, interval)}</p>
      <p className="text-black dark:text-white">{currentTitle}: {currentRevenue ? currentRevenue.toLocaleString() : '0'}</p>
      <p className="text-black dark:text-white">{previousTitle}: {previousRevenue ? previousRevenue.toLocaleString() : '0'}</p>
      <p className={`font-semibold ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
        {differenceTitle}: {difference ? difference.toLocaleString() : '0'} ({isPositive ? '+' : ''}{percentChange == 'NaN' ? '0' : percentChange}%)
      </p>
    </div>
  );
};
