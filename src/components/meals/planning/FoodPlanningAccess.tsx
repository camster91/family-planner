"use client";
import * as React from "react";
const Access = React.createContext({ enabled: false, personalRole: false });
/** Capability/role only; never seed household IDs, drafts or owner credentials. */
export function FoodPlanningAccess({
  enabled,
  role,
  children,
}: {
  enabled: boolean;
  role: string;
  children: React.ReactNode;
}) {
  return (
    <Access.Provider
      value={{ enabled, personalRole: ["parent", "teen"].includes(role) }}
    >
      {children}
    </Access.Provider>
  );
}
export const useFoodPlanningAccess = () => React.useContext(Access);
