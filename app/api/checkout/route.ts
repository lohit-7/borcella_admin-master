import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { connectToDB } from "@/lib/mongoDB";
import Order from "@/lib/models/Order";
import Customer from "@/lib/models/Customer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders });
}

export async function POST(req: NextRequest) {
  try {
    await connectToDB();
    const { cartItems, customer } = await req.json();

    if (!cartItems || !customer) {
      console.error("Missing cartItems or customer data:", { cartItems, customer });
      return NextResponse.json(
        { error: "Not enough data to checkout" },
        { status: 400, headers: corsHeaders }
      );
    }

    console.log("Creating Stripe session with the following data:", {
      cartItems,
      customer,
    });

    // Save or update customer details in the Customer model
    const existingCustomer = await Customer.findOne({ clerkId: customer.clerkId });
    if (!existingCustomer) {
      const newCustomer = new Customer({
        clerkId: customer.clerkId,
        email: customer.email,
        name: customer.name,
        createdAt: new Date(),
      });

      await newCustomer.save();
      console.log("Customer saved to the database:", newCustomer);
    } else {
      console.log("Customer already exists in the database:", existingCustomer);
    }

    // Create Stripe session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      shipping_address_collection: {
        allowed_countries: ["US", "CA", "IN"],
      },
      shipping_options: [
        { shipping_rate: "shr_1Qi4doKrUjEv12FJxGaV6hvy" },
      ],
      line_items: cartItems.map((cartItem: any) => ({
        price_data: {
          currency: "inr",
          product_data: {
            name: cartItem.item.title,
            metadata: {
              productId: cartItem.item._id,
              ...(cartItem.size && { size: cartItem.size }),
              ...(cartItem.color && { color: cartItem.color }),
            },
          },
          unit_amount: cartItem.item.price * 100,
        },
        quantity: cartItem.quantity,
      })),
      client_reference_id: customer.clerkId,
      metadata: {
        customerName: customer.name, // Add customer name in metadata for tracking
      },
      success_url: `${process.env.ECOMMERCE_STORE_URL}/payment_success`,
      cancel_url: `${process.env.ECOMMERCE_STORE_URL}/cart`,
    });

    console.log("Stripe session created successfully:", session);

    // Store the order in MongoDB
    const order = new Order({
      customerClerkId: customer.clerkId,
      customerName: customer.name, // Only store the name in the Order model
      products: cartItems.map((cartItem: any) => ({
        product: cartItem.item._id,
        quantity: cartItem.quantity,
        size: cartItem.size,
        color: cartItem.color,
      })),
      totalAmount: cartItems.reduce(
        (acc: number, item: any) => acc + item.item.price * item.quantity,
        0
      ),
      stripeSessionId: session.id,
      createdAt: new Date(),
    });

    await order.save();
    console.log("Order saved to the database:", order);

    return NextResponse.json(session, { headers: corsHeaders });
  } catch (err) {
    console.error("[checkout_POST]", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
