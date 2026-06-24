import { z } from 'zod';

export type BookingLang = 'en' | 'ar';

export const createBookingSchema = (lang: BookingLang = 'en') =>
  z.object({
    name: z
      .string()
      .min(1, lang === 'ar' ? 'Укажите имя' : 'Name is required')
      .min(2, lang === 'ar' ? 'Имя слишком короткое' : 'Name must be at least 2 characters'),
    email: z
      .string()
      .min(1, lang === 'ar' ? 'Укажите эл. почту' : 'Email is required')
      .email(lang === 'ar' ? 'Неверный адрес эл. почты' : 'Invalid email address'),
    phone: z
      .string()
      .regex(
        /^\+?[0-9\s\-()]{8,17}$/,
        lang === 'ar'
          ? 'Укажите номер телефона с кодом страны'
          : 'Enter a valid phone number with country code'
      ),
    notes: z.string().optional().or(z.literal('')),
    referralSource: z
      .enum(['google', 'twitter', 'instagram', 'facebook'])
      .optional(),
    agreedToPolicy: z.boolean().refine((value) => value === true, {
      message:
        lang === 'ar'
          ? 'Пожалуйста, подтвердите согласие с правилами записи.'
          : 'Please confirm you agree to the reservation policy.',
    }),
  });

export const bookingSchema = createBookingSchema('en');

export type BookingFormData = z.infer<typeof bookingSchema>;
