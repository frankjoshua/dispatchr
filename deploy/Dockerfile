# dispatchr as a static site: built here, served by nginx. It reaches rostr from the browser (same
# origin when served beside rostr, else VITE_ROSTR_URL), so the image holds no token.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG DISPATCHR_BASE=/
ARG VITE_ROSTR_URL=
ENV DISPATCHR_BASE=${DISPATCHR_BASE} VITE_ROSTR_URL=${VITE_ROSTR_URL}
RUN npm run build

FROM nginx:1.30-alpine
ARG DISPATCHR_BASE=/
ARG VITE_ROSTR_URL=
ENV DISPATCHR_BASE=${DISPATCHR_BASE} ROSTR_ORIGIN=${VITE_ROSTR_URL}
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
