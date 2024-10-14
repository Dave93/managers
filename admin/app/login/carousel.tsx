"use client";

import React from "react";
import Autoplay from "embla-carousel-autoplay";
import {
  Carousel,
  CarouselApi,
  CarouselContent,
  CarouselItem,
} from "@new_admin/components/ui/carousel";
import { Card, CardContent } from "@new_admin/components/ui/card";
import { DotButton, useDotButton } from "./carousel-dot-button";
import { cn } from "@new_admin/lib/utils";

export default function LoginCarousel() {
  const plugin = React.useRef(
    Autoplay({ delay: 6000, stopOnInteraction: true })
  );
  const [api, setApi] = React.useState<CarouselApi>();

  const { selectedIndex, scrollSnaps, onDotButtonClick } = useDotButton(api);
  return (
    <Carousel
      plugins={[plugin.current]}
      setApi={setApi}
      className="w-full h-full flex flex-col"
      onMouseEnter={plugin.current.stop}
      onMouseLeave={plugin.current.reset}
    >
      <CarouselContent parentClassName="flex-1">
        {Array.from({ length: 5 }).map((_, index) => (
          <CarouselItem key={index}>
            <div className="p-1 flex items-center justify-center h-full">
              <span className="text-4xl font-semibold">{index + 1}</span>
            </div>
          </CarouselItem>
        ))}
      </CarouselContent>
      <div className="flex justify-center gap-2 py-5">
        {scrollSnaps.map((_, index) => (
          <DotButton
            key={index}
            onClick={() => onDotButtonClick(index)}
            className={cn(
              "rounded-full w-3 h-3",
              index === selectedIndex ? "bg-slate-500" : "bg-slate-300"
            )}
          />
        ))}
      </div>
    </Carousel>
  );
}
