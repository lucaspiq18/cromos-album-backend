import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-06-24.dahlia',
})

export const PLATFORM_FEE_PERCENT = 25 // platform keeps 25%
export const CLUB_STRIPE_ACCOUNT = process.env.STRIPE_CLUB_ACCOUNT_ID!

export async function createPaymentIntent(
  amountCents: number,
  customerId: string,
): Promise<Stripe.PaymentIntent> {
  const clubAmount = Math.floor(amountCents * 0.75)

  return stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'eur',
    customer: customerId,
    transfer_data: {
      destination: CLUB_STRIPE_ACCOUNT,
      amount: clubAmount,
    },
    metadata: { platform_fee_cents: String(amountCents - clubAmount) },
  })
}

export async function getOrCreateCustomer(email: string, name: string): Promise<string> {
  const existing = await stripe.customers.list({ email, limit: 1 })
  if (existing.data.length > 0) return existing.data[0].id
  const customer = await stripe.customers.create({ email, name })
  return customer.id
}
