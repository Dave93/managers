"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useForm, SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import { Button } from "@admin/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import type { Session } from "next-auth";

// Define the form schema
const loginSchema = () =>
  z.object({
    login: z.string().min(1, "Логин обязателен"),
    password: z.string().min(6, "Пароль должен быть длиннее 6 символов"),
  });

type LoginFormValues = z.infer<ReturnType<typeof loginSchema>>;

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema()),
  });

  const onSubmit: SubmitHandler<LoginFormValues> = async (
    data: LoginFormValues
  ) => {
    setError("");
    const result = await signIn("credentials", {
      login: data.login,
      password: data.password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid username or password");
    } else {
      const session = await fetch("/api/auth/session");
      const sessionData = (await session.json()) as Session;
      if (sessionData.sessionCookie) {
        sessionData.sessionCookie.forEach((cookie) => {
          // @ts-ignore
          document.cookie = cookie + "; domain=" + process.env.COOKIE_DOMAIN;
        });
        router.push("/");
      } else {
        setError("Session cookie not found");
      }
    }
  };

  return (
    <div className="w-full max-w-lg p-8 space-y-8">
      <div className="text-center">
        <h2 className="mt-6 text-3xl font-extrabold text-slate-900 dark:text-slate-100">
          Авторизация
        </h2>
        <p className="mt-2 text-md text-slate-600 dark:text-slate-400">
          Введите логин и пароль для авторизации
        </p>
      </div>
      <form className="mt-8 space-y-6" onSubmit={handleSubmit(onSubmit)}>
        <div className="space-y-4">
          <div className="relative gap-2 grid items-center">
            <Label htmlFor="username">Логин</Label>
            <Input
              id="username"
              type="text"
              placeholder="Логин"
              {...register("login")}
              className={errors.login ? "border-red-500" : ""}
            />
            {errors.login && (
              <p className="text-red-500 text-sm">{errors.login.message}</p>
            )}
          </div>
          <div className="relative gap-2 grid items-center">
            <Label htmlFor="password">Пароль</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder="Пароль"
                {...register("password")}
                className={errors.password ? "border-red-500 pr-10" : "pr-10"}
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5 text-gray-400" />
                ) : (
                  <Eye className="h-5 w-5 text-gray-400" />
                )}
              </button>
            </div>
            {errors.password && (
              <p className="text-red-500 text-sm">{errors.password.message}</p>
            )}
          </div>
        </div>

        {error && (
          <div className="text-red-500 text-sm text-center">{error}</div>
        )}

        <div>
          <Button
            type="submit"
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Подождите..." : "Войти"}
          </Button>
        </div>
      </form>
    </div>
  );
}
