FROM node:22-alpine AS web-build
WORKDIR /src
RUN apk add --no-cache unzip
COPY fieldproof-railway-source.zip /tmp/source.zip
RUN unzip -q /tmp/source.zip -d /src
WORKDIR /src/app
ARG EXPO_PUBLIC_API_URL=same-origin
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL CI=1
RUN npm install
RUN npx expo export --platform web --output-dir dist

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY --from=web-build /src/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=web-build /src/backend/app ./app
COPY --from=web-build /src/backend/db ./db
COPY --from=web-build /src/backend/demo ./demo
COPY --from=web-build /src/backend/storage /data/evidence
COPY --from=web-build /src/app/dist /web
EXPOSE 8000
CMD ["sh","-c","uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
