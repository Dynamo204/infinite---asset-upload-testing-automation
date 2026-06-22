# GRN-based SAP asset creation

Enter a 101 GRN material document number in the UI. The server reads its material,
quantity, dates, plant, storage location, and serial numbers from SAP. It then:

- creates one fixed asset for every GRN serial number;
- writes that serial number to the corresponding asset master;
- splits and posts the configured total acquisition amount across the assets; and
- posts one 241 goods-issue item per asset/serial-number pair.

The create endpoint re-fetches the GRN, so client-side values cannot override SAP's
quantity, serial numbers, material, plant, storage location, or dates.

## Run locally

Set `SAP_USERNAME` and `SAP_PASSWORD` (or `SAP_AUTH_HEADER`) in `.env.local`, then run:

```sh
npm run server
npm run client
```

Alternatively, `npm run dev` starts both processes. The server defaults to port 4000;
Vite proxies `/api` requests there.
