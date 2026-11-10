import { signup } from "@/app/actions";
import { AuthForm } from "@/components/auth-form";

export default function SignupPage() {
  return <AuthForm mode="signup" action={signup} />;
}
