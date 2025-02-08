import React from "react";
import managarReports from "./page";
import Link from "next/link";
import { Button } from "@admin/components/ui/button";
import { ChevronLeft } from "lucide-react";
import dayjs from "dayjs";
function Back() {
  return (
    <div>
      <div className="grid grid-cols-3 items-center py-2 lg:hidden">
        <Link href="/manager_reports">
          <Button variant="outline" className="my-2">
            <ChevronLeft />
            Back
          </Button>
        </Link>
        <div className="font-bold text-2xl text-center my-2 mx-5">
          {dayjs().format("DD.MM.YYYY HH:mm")}
        </div>
      </div>
    </div>
  );
}

export default Back;
