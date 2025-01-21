import axios from "axios";

import { BASE_URL } from "@/constants/endpoints";

export const api = axios.create({
  baseURL: "/api",
  timeout: 10000,
});

export const axiosInstance = axios.create({
  baseURL: "http://192.168.0.27",
  timeout: 10000,
  withCredentials: true,
});
