import { db } from "./db.server";
import { createCookieSessionStorage, json, redirect } from "@remix-run/node";
import md5 from "md5";
import { Params } from "@remix-run/react";
const axios = require("axios").default;

type LoginForm = {
  username: string;
  password: string;
};

//TODO Improve this. bcrypt and hashed.
export async function login({ username, password }: LoginForm) {
  const user_check = await db.users.findUnique({
    where: { username },
  });
  const pass_check = await db.users.findUnique({
    where: { password },
  });
  console.log(user_check, pass_check);
  if (user_check && pass_check) {
    return user_check.id;
  } else {
    console.log("login failed");
  }
}

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error("SESSION_SECRET must be set");
}

const storage = createCookieSessionStorage({
  cookie: {
    name: "H4_session",
    // secure: process.env.NODE_ENV === "production",
    secure: false,
    secrets: [sessionSecret],
    sameSite: "lax",
    path: "/",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30,
  },
});

function getUserSession(request: Request) {
  console.log(request.headers.get("Cookie"));
  return storage.getSession(request.headers.get("Cookie"));
}
export async function getUserId(request: Request) {
  const session = await getUserSession(request);
  const userId = session.get("userId");
  if (!userId || typeof userId !== "string") return null;
  return userId;
}

export async function requireUserId(request: Request) {
  const session = await getUserSession(request);
  const userId = await session.get("userId");
  if (!userId || typeof userId !== "string") {
    throw redirect("/login");
  }
  return userId;
}

export async function createUserSession(userId: string, redirectTo: string) {
  const session = await storage.getSession();
  session.set("userId", userId);
  return redirect("/admin/all", {
    headers: {
      "Set-Cookie": await storage.commitSession(session),
    },
  });
}

export async function apiLogin(email: string, password: string) {
  const data = await fetch("https://pos.linisco.com.ar/users/sign_in", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      user: {
        email: email,
        password: password,
      },
    }),
  });
  const { authentication_token } = await data.json();
  return authentication_token;
}
export async function getDanielData(token: string, paging = 11) {
  let page = 1;
  let finalPaymentsData: any[] = [];
  while (page < paging) {
    console.log("while loop round", page);
    const data = await fetch(
      `https://api.fu.do/v1alpha1/sales?page[size]=500&page[number]=${page}&sort=-createdAt&include=payments.paymentMethod`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
    const _data = await data.json();
    page += 1;
    finalPaymentsData = [...finalPaymentsData, ..._data.included];
  }
  return finalPaymentsData;
}

export async function getAPIData({
  email,
  token,
  from,
  to,
}: {
  email: string;
  token: string;
  from: string;
  to: string;
}) {
  const orders = await axios({
    method: "get",
    url: "https://pos.linisco.com.ar/sale_orders",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-User-Email": email,
      "X-User-Token": token,
    },
    data: {
      fromDate: from,
      toDate: to,
    },
  });
  console.log("getAPIData called", orders.data.length);
  return orders.data;
}

export async function getUser(request: Request) {
  const userId = await getUserId(request);
  if (typeof userId !== "string") {
    return null;
  }

  try {
    const user = await db.users.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    return user;
  } catch {
    throw logout(request);
  }
}
export async function logout(request: Request) {
  const session = await getUserSession(request);
  return redirect("/login", {
    headers: {
      "Set-Cookie": await storage.destroySession(session),
    },
  });
}

export async function filterData(
  finalData: any[],
  from: string | number | Date,
  to: string | number | Date,
  filteredOrders: { [x: string]: { amount: any; count: number } }
) {
  finalData.forEach((order) => {
    const amount = order.attributes?.amount || 0;
    const createdAt = order.attributes?.createdAt || "";
    const paymentId = order.relationships?.paymentMethod?.data?.id || 0;
    if (
      new Date(createdAt.slice(0, 10)) >= new Date(from) &&
      new Date(createdAt.slice(0, 10)) <= new Date(to)
    ) {
      if (filteredOrders[paymentId]) {
        filteredOrders[paymentId].amount += amount;
        filteredOrders[paymentId].count += 1;
      } else {
        filteredOrders[paymentId] = { amount, count: 1 };
      }
    }
  });
}

export async function middleWareMireya(
  from: string | number | Date,
  to: string | number | Date,
  params: any
) {
  const finalPaymentsData = await getDanielData(
    process.env.MIREYA_TOKEN as string
  );
  console.log(finalPaymentsData);
  let mireyaOrders: any = {} as any;
  filterData(finalPaymentsData, from, to, mireyaOrders);
  let result = {
    from: from,
    to: to,
    localName: params.local as string,
    len: Object.keys(mireyaOrders).reduce(
      (acc, payId) => acc + mireyaOrders[payId].count,
      0
    ),
    salesTotal: Object.keys(mireyaOrders)
      .map((key) => mireyaOrders[key].amount)
      .reduce((acc, val) => acc + val, 0),
    cashTotal: mireyaOrders[1]?.amount,
  };
  return result;
}

export async function middleWareBotanico(
  from: string | number | Date,
  to: string | number | Date,
  params: Params<string>
) {
  const botanicoPaymentsData = await getDanielData(
    process.env.BOTANICO_TOKEN as string
  );
  let botanicofilteredOrders: any = {} as any;
  filterData(botanicoPaymentsData, from, to, botanicofilteredOrders);

  let botanicoresult = {
    from: from,
    to: to,
    localName: params.local as string,
    len: Object.keys(botanicofilteredOrders).reduce(
      (acc, payId) => acc + botanicofilteredOrders[payId].count,
      0
    ),
    salesTotal: Object.keys(botanicofilteredOrders)
      .map((key) => botanicofilteredOrders[key].amount)
      .reduce((acc, val) => acc + val, 0),
    cashTotal: botanicofilteredOrders[1]?.amount,
  };
  return botanicoresult;
}
