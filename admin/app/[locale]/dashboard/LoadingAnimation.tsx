import React from "react";
import { motion } from "framer-motion";
import { BarChart } from "lucide-react";
import { Card, CardContent } from "@admin/components/ui/card";

const LoadingAnimation = () => {
  return (
    <Card className="h-full flex flex-col">
      <CardContent className="flex items-center justify-center h-full">
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            rotate: [0, 360],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          <BarChart size={48} className="text-blue-500" />
        </motion.div>
      </CardContent>
    </Card>
  );
};

export default LoadingAnimation;
