FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1     PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# When building with context=backend/, copy from local app directory
COPY app /app/app
ENV PYTHONPATH=/app

RUN mkdir -p /app/uploads

EXPOSE 8000
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]
