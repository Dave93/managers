import React from "react";
import Back from "./Back";
export const ListboxWrapper = ({
  children: children,
}: {
  children: React.ReactNode;
}) => (
  <div className="w-full pr-4 border-small px-1 py-2 rounded-small border-default-200 dark:border-default-100">
    {children}
  </div>
);
