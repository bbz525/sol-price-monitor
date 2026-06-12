export type PriceStatus = "above" | "below";

export type AlertType = "breach" | "recovery";

export type AlertDecision = {
  nextStatus: PriceStatus;
  alertType: AlertType | null;
};

export type PriceTick = {
  symbol: string;
  price: number;
  eventTime: Date;
};

export type PendingAlert = {
  eventId: number;
  symbol: string;
  alertType: AlertType;
  price: number;
  thresholdPrice: number;
  status: PriceStatus;
  eventTime: Date;
};

export type Notifier = {
  send(alert: PendingAlert): Promise<void>;
};
