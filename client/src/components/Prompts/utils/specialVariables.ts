import {
  Calendar,
  User,
  Clock,
  Globe,
  Mail,
  MapPin,
  Users,
  Sparkles,
  Building2,
  Briefcase,
  UserCheck,
} from 'lucide-react';
import type { specialVariables } from 'librechat-data-provider';

type SpecialVariableKey = keyof typeof specialVariables;

export const specialVariableIcons: Record<
  SpecialVariableKey,
  React.ComponentType<{ className?: string }>
> = {
  current_date: Calendar,
  current_datetime: Clock,
  current_user: User,
  iso_datetime: Globe,
  librechat_user_jobtitle: Briefcase,
  librechat_user_department: Users,
  librechat_user_companyname: Building2,
  librechat_user_officelocation: MapPin,
  librechat_user_managername: UserCheck,
  librechat_user_manageremail: Mail,
};

export const getSpecialVariableIcon = (name: string) =>
  specialVariableIcons[name as SpecialVariableKey] ?? Sparkles;
