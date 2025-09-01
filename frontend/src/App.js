import React, { useState, useEffect, createContext, useContext } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// Auth Context
const AuthContext = createContext();

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      fetchUser();
    } else {
      setLoading(false);
    }
  }, []);

  const fetchUser = async () => {
    try {
      const response = await axios.get(`${API}/me`);
      setUser(response.data);
    } catch (error) {
      localStorage.removeItem('token');
      delete axios.defaults.headers.common['Authorization'];
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    const response = await axios.post(`${API}/login`, { email, password });
    const { access_token, user: userData } = response.data;
    
    localStorage.setItem('token', access_token);
    axios.defaults.headers.common['Authorization'] = `Bearer ${access_token}`;
    setUser(userData);
    
    return userData;
  };

  const register = async (email, password) => {
    const response = await axios.post(`${API}/register`, { email, password });
    return response.data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    delete axios.defaults.headers.common['Authorization'];
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

// Components
const Header = () => {
  const { user, logout } = useAuth();

  return (
    <header className="bg-gradient-to-r from-purple-600 to-pink-600 text-white p-4 shadow-lg">
      <div className="container mx-auto flex justify-between items-center">
        <h1 className="text-3xl font-bold">GiaStylez</h1>
        <nav className="flex items-center space-x-4">
          {user ? (
            <>
              <span className="text-sm">Welcome, {user.email}</span>
              {user.is_admin && (
                <a href="/admin" className="bg-yellow-500 px-3 py-1 rounded text-sm font-semibold">
                  Admin
                </a>
              )}
              <button
                onClick={logout}
                className="bg-red-500 hover:bg-red-600 px-4 py-2 rounded font-semibold"
              >
                Logout
              </button>
            </>
          ) : (
            <div className="space-x-2">
              <a href="/login" className="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded font-semibold">
                Login
              </a>
              <a href="/register" className="bg-green-500 hover:bg-green-600 px-4 py-2 rounded font-semibold">
                Register
              </a>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
};

const Home = () => {
  const { user } = useAuth();
  const [images, setImages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState({});
  const [newComment, setNewComment] = useState({});

  useEffect(() => {
    fetchImages();
  }, []);

  const fetchImages = async () => {
    try {
      const response = await axios.get(`${API}/images`);
      setImages(response.data);
    } catch (error) {
      console.error('Error fetching images:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchComments = async (imageId) => {
    if (comments[imageId]) return; // Already loaded
    
    try {
      const response = await axios.get(`${API}/images/${imageId}/comments`);
      setComments(prev => ({ ...prev, [imageId]: response.data }));
    } catch (error) {
      console.error('Error fetching comments:', error);
    }
  };

  const handleVote = async (imageId, voteType) => {
    if (!user) return;
    
    try {
      await axios.post(`${API}/images/${imageId}/vote`, { vote_type: voteType });
      fetchImages(); // Refresh to get updated vote counts
    } catch (error) {
      console.error('Error voting:', error);
    }
  };

  const handleLike = async (imageId) => {
    if (!user) return;
    
    try {
      await axios.post(`${API}/images/${imageId}/like`);
      fetchImages(); // Refresh to get updated like counts
    } catch (error) {
      console.error('Error liking:', error);
    }
  };

  const handleComment = async (imageId) => {
    if (!user || !newComment[imageId]?.trim()) return;
    
    try {
      await axios.post(`${API}/images/${imageId}/comments`, { 
        content: newComment[imageId] 
      });
      setNewComment(prev => ({ ...prev, [imageId]: '' }));
      // Refresh comments
      setComments(prev => ({ ...prev, [imageId]: null }));
      fetchComments(imageId);
    } catch (error) {
      console.error('Error commenting:', error);
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) return 'Today';
    if (diffDays === 2) return 'Yesterday';
    return `${diffDays - 1} days ago`;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-4xl font-bold text-gray-800">Image Feed</h2>
        {user && (
          <a
            href="/upload"
            className="bg-gradient-to-r from-purple-600 to-pink-600 text-white px-6 py-3 rounded-lg font-semibold hover:shadow-lg transition-all"
          >
            Upload Image
          </a>
        )}
      </div>

      {images.length === 0 ? (
        <div className="text-center text-gray-500 mt-16">
          <p className="text-xl">No images yet. Be the first to upload!</p>
        </div>
      ) : (
        <div className="grid gap-8">
          {images.map((image) => (
            <div key={image.id} className="bg-white rounded-lg shadow-lg overflow-hidden">
              <div className="p-4 border-b">
                <div className="flex justify-between items-center">
                  <div>
                    <h3 className="text-xl font-semibold">{image.title}</h3>
                    <p className="text-gray-500 text-sm">
                      by {image.user_email} • {formatDate(image.created_at)}
                      {image.expose_me && (
                        <span className="ml-2 bg-yellow-400 text-yellow-800 px-2 py-1 rounded-full text-xs font-semibold">
                          FEATURED
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right text-sm text-gray-500">
                    <p>Deletes in {3 - Math.ceil((new Date() - new Date(image.created_at)) / (1000 * 60 * 60 * 24))} days</p>
                  </div>
                </div>
              </div>
              
              <div className="relative">
                <img
                  src={`data:image/jpeg;base64,${image.image_data}`}
                  alt={image.title}
                  className="w-full max-h-96 object-contain bg-gray-100"
                  onContextMenu={(e) => e.preventDefault()} // Disable right-click
                  draggable={false} // Disable drag
                />
                <div className="absolute inset-0 pointer-events-none select-none"></div>
              </div>

              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-4">
                    {user && (
                      <>
                        <button
                          onClick={() => handleVote(image.id, 'up')}
                          className="flex items-center space-x-1 text-green-600 hover:text-green-700"
                        >
                          <span>↑</span>
                        </button>
                        <span className="font-semibold">{image.votes}</span>
                        <button
                          onClick={() => handleVote(image.id, 'down')}
                          className="flex items-center space-x-1 text-red-600 hover:text-red-700"
                        >
                          <span>↓</span>
                        </button>
                        <button
                          onClick={() => handleLike(image.id)}
                          className="flex items-center space-x-1 text-pink-600 hover:text-pink-700"
                        >
                          <span>♥</span>
                          <span>{image.likes}</span>
                        </button>
                      </>
                    )}
                    {!user && (
                      <div className="flex items-center space-x-4 text-gray-500">
                        <span>↑ {image.votes} ↓</span>
                        <span>♥ {image.likes}</span>
                      </div>
                    )}
                  </div>
                  
                  {user && (
                    <button
                      onClick={() => fetchComments(image.id)}
                      className="text-blue-600 hover:text-blue-700 font-semibold"
                    >
                      Comments
                    </button>
                  )}
                </div>

                {user && comments[image.id] && (
                  <div className="border-t pt-4">
                    <div className="mb-4">
                      <input
                        type="text"
                        placeholder="Add a comment..."
                        value={newComment[image.id] || ''}
                        onChange={(e) => setNewComment(prev => ({ ...prev, [image.id]: e.target.value }))}
                        className="w-full p-2 border rounded-lg"
                      />
                      <button
                        onClick={() => handleComment(image.id)}
                        className="mt-2 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
                      >
                        Comment
                      </button>
                    </div>
                    
                    <div className="space-y-2">
                      {comments[image.id].map((comment) => (
                        <div key={comment.id} className="bg-gray-50 p-3 rounded">
                          <p className="text-sm text-gray-600">
                            <strong>{comment.user_email}</strong> • {formatDate(comment.created_at)}
                          </p>
                          <p>{comment.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Login = () => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      window.location.href = '/';
    } catch (error) {
      setError(error.response?.data?.detail || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-100 to-pink-100">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-3xl font-bold text-center text-gray-800 mb-8">Login to GiaStylez</h2>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
              required
            />
          </div>
          
          <div>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
              required
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm text-center">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white p-3 rounded-lg font-semibold hover:shadow-lg transition-all disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <div className="text-center mt-6">
          <span className="text-gray-600">Don't have an account? </span>
          <a href="/register" className="text-purple-600 hover:text-purple-700 font-semibold">
            Register here
          </a>
        </div>
      </div>
    </div>
  );
};

const Register = () => {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      await register(email, password);
      setSuccess('Registration successful! You can now login.');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      setError(error.response?.data?.detail || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-100 to-pink-100">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
        <h2 className="text-3xl font-bold text-center text-gray-800 mb-8">Join GiaStylez</h2>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
              required
            />
          </div>
          
          <div>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
              required
            />
          </div>

          <div>
            <input
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
              required
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm text-center">{error}</div>
          )}

          {success && (
            <div className="text-green-600 text-sm text-center">{success}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white p-3 rounded-lg font-semibold hover:shadow-lg transition-all disabled:opacity-50"
          >
            {loading ? 'Registering...' : 'Register'}
          </button>
        </form>

        <div className="text-center mt-6">
          <span className="text-gray-600">Already have an account? </span>
          <a href="/login" className="text-purple-600 hover:text-purple-700 font-semibold">
            Login here
          </a>
        </div>
      </div>
    </div>
  );
};

const Upload = () => {
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [image, setImage] = useState(null);
  const [exposeMe, setExposeMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setImage(e.target.result.split(',')[1]); // Remove data:image/jpeg;base64, prefix
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!title.trim()) {
      setError('Please enter a title');
      return;
    }

    if (!image) {
      setError('Please select an image');
      return;
    }

    setLoading(true);

    try {
      await axios.post(`${API}/images`, {
        title: title.trim(),
        image_data: image,
        expose_me: exposeMe
      });
      
      setSuccess('Image uploaded successfully!');
      setTitle('');
      setImage(null);
      setExposeMe(false);
      document.getElementById('image-input').value = '';
      
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } catch (error) {
      setError(error.response?.data?.detail || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return <Navigate to="/login" />;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-4xl font-bold text-center text-gray-800 mb-8">Upload Your Image</h2>
        
        <div className="bg-white p-8 rounded-lg shadow-lg">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                placeholder="Enter image title..."
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Image</label>
              <input
                id="image-input"
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-purple-600 focus:border-transparent"
                required
              />
              {image && (
                <div className="mt-4">
                  <img
                    src={`data:image/jpeg;base64,${image}`}
                    alt="Preview"
                    className="max-w-full h-64 object-contain mx-auto border rounded"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="expose-me"
                checked={exposeMe}
                onChange={(e) => setExposeMe(e.target.checked)}
                className="rounded"
              />
              <label htmlFor="expose-me" className="text-sm font-semibold text-gray-700">
                Expose Me (Higher priority in feed, longer visibility)
              </label>
            </div>

            {error && (
              <div className="text-red-600 text-sm text-center">{error}</div>
            )}

            {success && (
              <div className="text-green-600 text-sm text-center">{success}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white p-3 rounded-lg font-semibold hover:shadow-lg transition-all disabled:opacity-50"
            >
              {loading ? 'Uploading...' : 'Upload Image'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

const Admin = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.is_admin) {
      fetchStats();
      fetchUsers();
    }
  }, [user]);

  const fetchStats = async () => {
    try {
      const response = await axios.get(`${API}/admin/stats`);
      setStats(response.data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await axios.get(`${API}/admin/users`);
      setUsers(response.data);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleBanUser = async (userId) => {
    try {
      await axios.post(`${API}/admin/users/${userId}/ban`);
      fetchUsers();
    } catch (error) {
      console.error('Error banning user:', error);
    }
  };

  const handleUnbanUser = async (userId) => {
    try {
      await axios.post(`${API}/admin/users/${userId}/unban`);
      fetchUsers();
    } catch (error) {
      console.error('Error unbanning user:', error);
    }
  };

  if (!user?.is_admin) {
    return <Navigate to="/" />;
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h2 className="text-4xl font-bold text-center text-gray-800 mb-8">Admin Dashboard</h2>
      
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6 mb-8">
          <div className="bg-blue-500 text-white p-6 rounded-lg shadow-lg text-center">
            <h3 className="text-2xl font-bold">{stats.users}</h3>
            <p>Users</p>
          </div>
          <div className="bg-green-500 text-white p-6 rounded-lg shadow-lg text-center">
            <h3 className="text-2xl font-bold">{stats.images}</h3>
            <p>Images</p>
          </div>
          <div className="bg-yellow-500 text-white p-6 rounded-lg shadow-lg text-center">
            <h3 className="text-2xl font-bold">{stats.comments}</h3>
            <p>Comments</p>
          </div>
          <div className="bg-purple-500 text-white p-6 rounded-lg shadow-lg text-center">
            <h3 className="text-2xl font-bold">{stats.votes}</h3>
            <p>Votes</p>
          </div>
          <div className="bg-pink-500 text-white p-6 rounded-lg shadow-lg text-center">
            <h3 className="text-2xl font-bold">{stats.likes}</h3>
            <p>Likes</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
        <div className="bg-gray-800 text-white p-4">
          <h3 className="text-xl font-semibold">User Management</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Joined</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Admin</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="px-6 py-4 whitespace-nowrap">{user.email}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {user.is_admin ? (
                      <span className="bg-yellow-100 text-yellow-800 px-2 py-1 rounded-full text-xs">Admin</span>
                    ) : (
                      <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded-full text-xs">User</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {user.is_banned ? (
                      <span className="bg-red-100 text-red-800 px-2 py-1 rounded-full text-xs">Banned</span>
                    ) : (
                      <span className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-xs">Active</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {!user.is_admin && (
                      <>
                        {user.is_banned ? (
                          <button
                            onClick={() => handleUnbanUser(user.id)}
                            className="text-green-600 hover:text-green-700 font-semibold mr-4"
                          >
                            Unban
                          </button>
                        ) : (
                          <button
                            onClick={() => handleBanUser(user.id)}
                            className="text-red-600 hover:text-red-700 font-semibold mr-4"
                          >
                            Ban
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// Protected Route component
const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return user ? children : <Navigate to="/login" />;
};

function App() {
  return (
    <AuthProvider>
      <div className="App min-h-screen bg-gray-50">
        <BrowserRouter>
          <Header />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/upload" element={<ProtectedRoute><Upload /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
          </Routes>
        </BrowserRouter>
      </div>
    </AuthProvider>
  );
}

export default App;