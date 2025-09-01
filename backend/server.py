from fastapi import FastAPI, APIRouter, HTTPException, Depends, File, UploadFile, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt
import base64
import asyncio
from pymongo import DESCENDING

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Configuration
JWT_SECRET = os.environ.get('JWT_SECRET', 'your-secret-key-change-in-production')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Security
security = HTTPBearer()

# Create the main app without a prefix
app = FastAPI(title="GiaStylez API", version="1.0.0")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Models
class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    email: EmailStr
    password: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    is_admin: bool = False
    is_banned: bool = False

class UserCreate(BaseModel):
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    created_at: datetime
    is_admin: bool

class Image(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    image_data: str  # base64 encoded
    user_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    expose_me: bool = False
    votes: int = 0
    likes: int = 0

class ImageCreate(BaseModel):
    title: str
    image_data: str
    expose_me: bool = False

class ImageResponse(BaseModel):
    id: str
    title: str
    image_data: str
    user_id: str
    created_at: datetime
    expose_me: bool
    votes: int
    likes: int
    user_email: Optional[str] = None

class Comment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    image_id: str
    user_id: str
    content: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class CommentCreate(BaseModel):
    content: str

class CommentResponse(BaseModel):
    id: str
    image_id: str
    user_id: str
    content: str
    created_at: datetime
    user_email: Optional[str] = None

class Vote(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    image_id: str
    user_id: str
    vote_type: str  # "up" or "down"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class VoteCreate(BaseModel):
    vote_type: str

class Like(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    image_id: str
    user_id: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# Utility functions
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_jwt_token(user_id: str) -> str:
    payload = {
        "user_id": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_jwt_token(token: str) -> str:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload["user_id"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    user_id = verify_jwt_token(credentials.credentials)
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("is_banned", False):
        raise HTTPException(status_code=403, detail="User is banned")
    return User(**user)

async def get_admin_user(current_user: User = Depends(get_current_user)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user

# Auto-cleanup job for 2-day old images
async def cleanup_old_images():
    while True:
        try:
            two_days_ago = datetime.now(timezone.utc) - timedelta(days=2)
            
            # Find images older than 2 days
            old_images = await db.images.find({"created_at": {"$lt": two_days_ago}}).to_list(1000)
            
            for image in old_images:
                # Delete associated comments and votes
                await db.comments.delete_many({"image_id": image["id"]})
                await db.votes.delete_many({"image_id": image["id"]})
                await db.likes.delete_many({"image_id": image["id"]})
                
                # Delete the image
                await db.images.delete_one({"id": image["id"]})
                
                logging.info(f"Deleted old image: {image['id']}")
            
            # Sleep for 1 hour before next cleanup
            await asyncio.sleep(3600)
        except Exception as e:
            logging.error(f"Error in cleanup job: {e}")
            await asyncio.sleep(3600)

# Authentication routes
@api_router.post("/register", response_model=UserResponse)
async def register_user(user_data: UserCreate):
    # Check if user already exists
    existing_user = await db.users.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create user
    hashed_password = hash_password(user_data.password)
    user = User(email=user_data.email, password=hashed_password)
    
    # Make first user admin
    users_count = await db.users.count_documents({})
    if users_count == 0:
        user.is_admin = True
    
    await db.users.insert_one(user.dict())
    return UserResponse(id=user.id, email=user.email, created_at=user.created_at, is_admin=user.is_admin)

@api_router.post("/login")
async def login_user(user_data: UserLogin):
    user = await db.users.find_one({"email": user_data.email})
    if not user or not verify_password(user_data.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if user.get("is_banned", False):
        raise HTTPException(status_code=403, detail="User is banned")
    
    token = create_jwt_token(user["id"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": UserResponse(id=user["id"], email=user["email"], created_at=user["created_at"], is_admin=user.get("is_admin", False))
    }

@api_router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: User = Depends(get_current_user)):
    return UserResponse(id=current_user.id, email=current_user.email, created_at=current_user.created_at, is_admin=current_user.is_admin)

# Image routes
@api_router.post("/images", response_model=ImageResponse)
async def upload_image(image_data: ImageCreate, current_user: User = Depends(get_current_user)):
    image = Image(
        title=image_data.title,
        image_data=image_data.image_data,
        user_id=current_user.id,
        expose_me=image_data.expose_me
    )
    await db.images.insert_one(image.dict())
    
    # Return with user email
    user = await db.users.find_one({"id": current_user.id})
    return ImageResponse(**image.dict(), user_email=user["email"])

@api_router.get("/images", response_model=List[ImageResponse])
async def get_images(skip: int = 0, limit: int = 20):
    # Sort by expose_me first (priority), then by votes, then by created_at
    images = await db.images.find().sort([
        ("expose_me", DESCENDING),
        ("votes", DESCENDING),
        ("created_at", DESCENDING)
    ]).skip(skip).limit(limit).to_list(limit)
    
    # Add user email to each image
    result = []
    for image in images:
        user = await db.users.find_one({"id": image["user_id"]})
        image_response = ImageResponse(**image, user_email=user["email"] if user else None)
        result.append(image_response)
    
    return result

@api_router.get("/images/{image_id}", response_model=ImageResponse)
async def get_image(image_id: str):
    image = await db.images.find_one({"id": image_id})
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    user = await db.users.find_one({"id": image["user_id"]})
    return ImageResponse(**image, user_email=user["email"] if user else None)

@api_router.delete("/images/{image_id}")
async def delete_image(image_id: str, current_user: User = Depends(get_current_user)):
    image = await db.images.find_one({"id": image_id})
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # Only owner or admin can delete
    if image["user_id"] != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized to delete this image")
    
    # Delete associated data
    await db.comments.delete_many({"image_id": image_id})
    await db.votes.delete_many({"image_id": image_id})
    await db.likes.delete_many({"image_id": image_id})
    await db.images.delete_one({"id": image_id})
    
    return {"message": "Image deleted successfully"}

# Voting routes
@api_router.post("/images/{image_id}/vote")
async def vote_image(image_id: str, vote_data: VoteCreate, current_user: User = Depends(get_current_user)):
    if vote_data.vote_type not in ["up", "down"]:
        raise HTTPException(status_code=400, detail="Invalid vote type")
    
    image = await db.images.find_one({"id": image_id})
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # Check if user already voted
    existing_vote = await db.votes.find_one({"image_id": image_id, "user_id": current_user.id})
    
    if existing_vote:
        if existing_vote["vote_type"] == vote_data.vote_type:
            # Remove vote if same type
            await db.votes.delete_one({"id": existing_vote["id"]})
            vote_change = -1 if vote_data.vote_type == "up" else 1
        else:
            # Change vote type
            await db.votes.update_one(
                {"id": existing_vote["id"]},
                {"$set": {"vote_type": vote_data.vote_type}}
            )
            vote_change = 2 if vote_data.vote_type == "up" else -2
    else:
        # New vote
        vote = Vote(image_id=image_id, user_id=current_user.id, vote_type=vote_data.vote_type)
        await db.votes.insert_one(vote.dict())
        vote_change = 1 if vote_data.vote_type == "up" else -1
    
    # Update image vote count
    await db.images.update_one(
        {"id": image_id},
        {"$inc": {"votes": vote_change}}
    )
    
    return {"message": "Vote updated successfully"}

# Like routes
@api_router.post("/images/{image_id}/like")
async def like_image(image_id: str, current_user: User = Depends(get_current_user)):
    image = await db.images.find_one({"id": image_id})
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # Check if user already liked
    existing_like = await db.likes.find_one({"image_id": image_id, "user_id": current_user.id})
    
    if existing_like:
        # Unlike
        await db.likes.delete_one({"id": existing_like["id"]})
        await db.images.update_one({"id": image_id}, {"$inc": {"likes": -1}})
        return {"message": "Image unliked"}
    else:
        # Like
        like = Like(image_id=image_id, user_id=current_user.id)
        await db.likes.insert_one(like.dict())
        await db.images.update_one({"id": image_id}, {"$inc": {"likes": 1}})
        return {"message": "Image liked"}

# Comment routes
@api_router.post("/images/{image_id}/comments", response_model=CommentResponse)
async def create_comment(image_id: str, comment_data: CommentCreate, current_user: User = Depends(get_current_user)):
    image = await db.images.find_one({"id": image_id})
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    comment = Comment(
        image_id=image_id,
        user_id=current_user.id,
        content=comment_data.content
    )
    await db.comments.insert_one(comment.dict())
    
    return CommentResponse(**comment.dict(), user_email=current_user.email)

@api_router.get("/images/{image_id}/comments", response_model=List[CommentResponse])
async def get_comments(image_id: str):
    comments = await db.comments.find({"image_id": image_id}).sort("created_at", 1).to_list(1000)
    
    # Add user email to each comment
    result = []
    for comment in comments:
        user = await db.users.find_one({"id": comment["user_id"]})
        comment_response = CommentResponse(**comment, user_email=user["email"] if user else None)
        result.append(comment_response)
    
    return result

@api_router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: str, current_user: User = Depends(get_current_user)):
    comment = await db.comments.find_one({"id": comment_id})
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    
    # Only owner or admin can delete
    if comment["user_id"] != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized to delete this comment")
    
    await db.comments.delete_one({"id": comment_id})
    return {"message": "Comment deleted successfully"}

# Admin routes
@api_router.get("/admin/users", response_model=List[UserResponse])
async def get_all_users(admin_user: User = Depends(get_admin_user)):
    users = await db.users.find().to_list(1000)
    return [UserResponse(id=user["id"], email=user["email"], created_at=user["created_at"], is_admin=user.get("is_admin", False)) for user in users]

@api_router.post("/admin/users/{user_id}/ban")
async def ban_user(user_id: str, admin_user: User = Depends(get_admin_user)):
    result = await db.users.update_one({"id": user_id}, {"$set": {"is_banned": True}})
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User banned successfully"}

@api_router.post("/admin/users/{user_id}/unban")
async def unban_user(user_id: str, admin_user: User = Depends(get_admin_user)):
    result = await db.users.update_one({"id": user_id}, {"$set": {"is_banned": False}})
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": "User unbanned successfully"}

@api_router.get("/admin/stats")
async def get_admin_stats(admin_user: User = Depends(get_admin_user)):
    users_count = await db.users.count_documents({})
    images_count = await db.images.count_documents({})
    comments_count = await db.comments.count_documents({})
    votes_count = await db.votes.count_documents({})
    likes_count = await db.likes.count_documents({})
    
    return {
        "users": users_count,
        "images": images_count,
        "comments": comments_count,
        "votes": votes_count,
        "likes": likes_count
    }

# Root route
@api_router.get("/")
async def root():
    return {"message": "Welcome to GiaStylez API"}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("startup")
async def startup_event():
    # Start cleanup job in background
    asyncio.create_task(cleanup_old_images())

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()