import { Switch } from "@admin/components/ui/switch";
import React from "react";

interface ToggleActualColumnProps {
  showActualColumn: boolean;
  toggleShowActualColumn: () => void;
}

const ToggleActualColumn: React.FC<ToggleActualColumnProps> = ({
  showActualColumn,
  toggleShowActualColumn,
}) => {
  return (
    <div className="flex items-center space-x-2">
      <Switch
        checked={showActualColumn}
        onCheckedChange={toggleShowActualColumn}
      />
      <label>Актуально</label>
    </div>
  );
};

export default ToggleActualColumn;
