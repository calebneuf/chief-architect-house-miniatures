FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN sed -i 's/\r$//' /app/scripts/healthcheck.sh && chmod +x /app/scripts/healthcheck.sh

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=10s --retries=8 --start-period=90s \
  CMD ["/app/scripts/healthcheck.sh"]

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--log-level", "debug"]
