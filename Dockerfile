FROM alpine:3.20 AS source
WORKDIR /src
RUN apk add --no-cache unzip coreutils
COPY bundle/ /tmp/bundle/
RUN cat /tmp/bundle/chunk00 \
        /tmp/bundle/chunk01a /tmp/bundle/chunk01b /tmp/bundle/chunk01c \
        /tmp/bundle/chunk02 /tmp/bundle/chunk03 /tmp/bundle/chunk04 \
        /tmp/bundle/chunk05a /tmp/bundle/chunk05b /tmp/bundle/chunk05c \
        /tmp/bundle/chunk06 /tmp/bundle/chunk07 /tmp/bundle/chunk08 > /tmp/source.b64 \
 && base64 -d /tmp/source.b64 > /tmp/source.zip \
 && unzip -q /tmp/source.zip -d /src \
 && test -f /src/app/package.json \
 && test -f /src/backend/app/main.py

FROM node:22-alpine AS web-build
WORKDIR /websrc
ARG EXPO_PUBLIC_API_URL=same-origin
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL CI=1
COPY --from=source /src/app/package.json ./
RUN npm install
COPY --from=source /src/app/ ./
# This app uses App.tsx/AppEntry (not expo-router). Build it as a single-page web export.
RUN sed -i 's/"output": "static"/"output": "single"/' app.json \
 && npx expo export --platform web --output-dir dist

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY --from=source /src/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=source /src/backend/app ./app
COPY --from=source /src/backend/db ./db
RUN mkdir -p /data/evidence
COPY --from=web-build /websrc/dist /web
EXPOSE 8000
CMD ["sh","-c","uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
