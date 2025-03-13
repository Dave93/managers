import React from "react";
import { motion } from "framer-motion";
import { BarChart, LineChart, PieChart, Activity, TrendingUp, ChevronUp } from "lucide-react";
import { Card, CardContent } from "@admin/components/ui/card";

const LoadingAnimation = () => {
  // Варианты анимации для пульсации
  const pulseVariants = {
    initial: { opacity: 0.6, scale: 0.95 },
    animate: {
      opacity: [0.6, 0.8, 0.6],
      scale: [0.95, 1, 0.95],
      transition: {
        duration: 3,
        repeat: Infinity,
        ease: "easeInOut",
      }
    }
  };

  // Варианты анимации для вращения
  const rotateVariants = {
    animate: {
      rotate: 360,
      transition: {
        duration: 8,
        repeat: Infinity,
        ease: "linear",
      }
    }
  };

  // Варианты анимации для графика
  const chartLineVariants = {
    initial: { pathLength: 0, opacity: 0 },
    animate: {
      pathLength: 1,
      opacity: 1,
      transition: {
        pathLength: {
          duration: 2,
          repeat: Infinity,
          repeatType: "loop",
          ease: "easeInOut"
        },
        opacity: { duration: 0.3 }
      }
    }
  };

  // Варианты анимации для точек данных
  const dataPointVariants = {
    initial: { y: 0, opacity: 0 },
    animate: (custom: number) => ({
      y: [0, -8, 0],
      opacity: [0.3, 1, 0.3],
      scale: [0.8, 1, 0.8],
      transition: {
        y: {
          duration: 1.5,
          repeat: Infinity,
          repeatType: "reverse",
          ease: "easeInOut",
          delay: custom * 0.15
        },
        opacity: {
          duration: 1.5,
          repeat: Infinity,
          repeatType: "reverse",
          ease: "easeInOut",
          delay: custom * 0.15
        },
        scale: {
          duration: 1.5,
          repeat: Infinity,
          repeatType: "reverse",
          ease: "easeInOut",
          delay: custom * 0.15
        }
      }
    })
  };

  // Варианты анимации для плавающих элементов
  const floatingVariants = {
    animate: (custom: number) => ({
      y: [0, custom % 2 === 0 ? -10 : 10, 0],
      x: [0, custom * 3, 0],
      rotate: [0, custom * 5, 0],
      opacity: [0.5, 0.9, 0.5],
      transition: {
        y: {
          duration: 3 + Math.abs(custom % 3),
          repeat: Infinity,
          ease: "easeInOut",
        },
        x: {
          duration: 4 + Math.abs(custom % 2),
          repeat: Infinity,
          ease: "easeInOut",
        },
        rotate: {
          duration: 4 + Math.abs(custom % 2),
          repeat: Infinity,
          ease: "easeInOut",
        },
        opacity: {
          duration: 2 + Math.abs(custom % 2),
          repeat: Infinity,
          ease: "easeInOut",
        }
      }
    })
  };

  return (
    <Card className="h-full flex flex-col overflow-hidden">
      <CardContent className="flex items-center justify-center h-full">
        <div className="relative flex flex-col items-center">
          {/* Фоновый градиентный круг с пульсацией */}
          <motion.div
            className="absolute w-40 h-40 bg-gradient-to-tr from-blue-100/80 to-indigo-100/80 dark:from-blue-900/20 dark:to-indigo-800/20 rounded-full blur-sm"
            variants={pulseVariants}
            initial="initial"
            animate="animate"
          />

          {/* Вращающийся круг с градиентной обводкой */}
          <motion.div
            className="absolute w-36 h-36 rounded-full border-2 border-transparent"
            style={{
              background: "linear-gradient(white, white) padding-box, linear-gradient(to right, #3b82f6, #8b5cf6) border-box",
            }}
            variants={rotateVariants}
            animate="animate"
          />

          {/* Плавающие элементы */}
          <div className="absolute w-full h-full">
            <motion.div
              className="absolute top-0 left-1/4"
              custom={5}
              variants={floatingVariants}
              animate="animate"
            >
              <ChevronUp size={12} className="text-blue-400 dark:text-blue-300" />
            </motion.div>
            <motion.div
              className="absolute bottom-1/4 right-1/4"
              custom={8}
              variants={floatingVariants}
              animate="animate"
            >
              <ChevronUp size={14} className="text-indigo-400 dark:text-indigo-300" />
            </motion.div>
            <motion.div
              className="absolute top-1/3 right-1/4"
              custom={7}
              variants={floatingVariants}
              animate="animate"
            >
              <div className="w-2 h-2 bg-green-400 dark:bg-green-300 rounded-full" />
            </motion.div>
            <motion.div
              className="absolute bottom-1/3 left-1/3"
              custom={6}
              variants={floatingVariants}
              animate="animate"
            >
              <div className="w-1.5 h-1.5 bg-purple-400 dark:bg-purple-300 rounded-full" />
            </motion.div>
          </div>

          {/* Центральная иконка с эффектом */}
          <motion.div
            className="relative z-10 bg-white dark:bg-gray-800 rounded-full p-3 shadow-md"
            animate={{
              boxShadow: [
                "0 4px 12px rgba(59, 130, 246, 0.2)",
                "0 4px 20px rgba(59, 130, 246, 0.4)",
                "0 4px 12px rgba(59, 130, 246, 0.2)",
              ],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <TrendingUp size={32} className="text-blue-500" />
          </motion.div>

          {/* Имитация графика */}
          <div className="mt-10 relative w-56 h-20">
            {/* Фон графика */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-blue-50/30 dark:to-blue-900/10 rounded-lg" />

            {/* Линия графика */}
            <svg width="100%" height="100%" viewBox="0 0 100 40" className="absolute">
              <defs>
                <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
              <motion.path
                d="M0,30 C10,28 20,10 30,15 C40,20 50,25 60,18 C70,10 80,5 100,15"
                fill="transparent"
                stroke="url(#lineGradient)"
                strokeWidth="2.5"
                strokeLinecap="round"
                variants={chartLineVariants}
                initial="initial"
                animate="animate"
              />
            </svg>

            {/* Точки данных */}
            <div className="absolute top-0 left-0 w-full h-full flex justify-between px-2">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <motion.div
                  key={i}
                  className="w-2.5 h-2.5 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 shadow-sm"
                  style={{ marginTop: `${10 + (i % 3) * 10}px` }}
                  custom={i}
                  variants={dataPointVariants}
                  initial="initial"
                  animate="animate"
                />
              ))}
            </div>
          </div>

          {/* Текст загрузки */}
          <motion.div
            className="mt-6 text-sm font-medium text-gray-600 dark:text-gray-300"
            animate={{ opacity: [0.7, 1, 0.7] }}
            transition={{
              duration: 1.8,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            Загрузка данных...
          </motion.div>
        </div>
      </CardContent>
    </Card>
  );
};

export default LoadingAnimation;
