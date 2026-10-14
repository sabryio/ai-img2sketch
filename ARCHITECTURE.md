# Architecture Documentation

## Overview

This project implements a **Clean Architecture** pattern with clear separation between domain logic, application use cases, infrastructure, and presentation layers. The design follows **SOLID principles** throughout.

## Architecture Layers

### 1. Domain Layer (`src/ai_img2sketch/domain/`)

The innermost layer containing business entities and value objects. This layer has no dependencies on outer layers.

#### Entities
- **Image**: Represents an image with validation and transformation methods
- **Hand**: Represents the drawing hand with mask data
- **Video**: Represents the output video configuration

#### Value Objects (Immutable)
- **Dimensions**: Width/height with validation and utility methods
- **VideoConfig**: Configuration for video generation with Pydantic validation

**Key Characteristics:**
- Pure business logic
- No external dependencies (except Pydantic for validation)
- Immutable where appropriate (frozen models)
- Type-safe with full type hints

### 2. Application Layer (`src/ai_img2sketch/application/`)

Contains use cases that orchestrate domain entities to fulfill business requirements.

#### Use Cases
- **GenerateSketchVideoUseCase**: Main use case for video generation
  - Coordinates image preprocessing
  - Manages hand loading
  - Orchestrates drawing animation
  - Handles video output

**Key Characteristics:**
- Single Responsibility: Each use case does one thing
- Dependency Inversion: Depends on abstractions (protocols)
- No framework dependencies

### 3. Infrastructure Layer (`src/ai_img2sketch/infrastructure/`)

Concrete implementations of services and external integrations.

#### Image Processing Services
- **OpenCVImagePreprocessor**: Image preprocessing using OpenCV
- **HandOverlayService**: Overlays hand on frames
- **DrawingPathCalculator**: Calculates optimal drawing paths
- **GridCalculator**: Handles grid splitting and calculation
- **DimensionAdjuster**: Adjusts dimensions to standard resolutions

#### Video Services
- **OpenCVVideoWriter**: Video writing implementation using OpenCV

**Key Characteristics:**
- Interface Segregation: Small, focused protocols
- Liskov Substitution: Implementations are interchangeable
- Concrete implementations of domain services

### 4. Presentation Layer (`src/ai_img2sketch/presentation/`)

User interface layer - in this case, a CLI built with Click and Rich.

#### CLI Interface
- **cli.py**: Click-based command-line interface
  - `generate`: Generate sketch video from image
  - `info`: Display image information and recommendations

**Key Characteristics:**
- Beautiful terminal output using Rich
- Type-safe command arguments
- Clear error messages
- Progress feedback

## Design Patterns

### 1. Repository Pattern
- Abstracts data access through protocols
- Easy to swap implementations

### 2. Strategy Pattern
- Different preprocessing strategies can be swapped
- Video writers can be changed without affecting use cases

### 3. Dependency Injection
- Dependencies passed through constructors
- Makes testing easier

### 4. Value Object Pattern
- Immutable value objects (Dimensions, VideoConfig)
- Ensures data integrity

## SOLID Principles Application

### Single Responsibility Principle (SRP)
- Each class has one reason to change
- `HandOverlayService` only handles hand overlay
- `DrawingPathCalculator` only calculates paths

### Open/Closed Principle (OCP)
- Open for extension, closed for modification
- New preprocessors can be added without changing use cases
- Protocol-based design allows extensions

### Liskov Substitution Principle (LSP)
- Any `VideoWriterProtocol` implementation works
- Preprocessor implementations are interchangeable

### Interface Segregation Principle (ISP)
- Small, focused protocols
- `VideoWriterProtocol` has minimal methods
- No fat interfaces

### Dependency Inversion Principle (DIP)
- High-level modules don't depend on low-level modules
- Use cases depend on protocols, not concrete implementations
- Domain layer is independent

## Data Flow

```
CLI Input
    ↓
Use Case (Application Layer)
    ↓
Domain Entities + Value Objects
    ↓
Infrastructure Services (OpenCV, etc.)
    ↓
Video Output
```

## Type Safety

- **Pydantic**: Runtime validation for domain models
- **Type Hints**: Full type coverage using Python 3.10+ syntax
- **ty**: Type checking at development time
- **numpy.typing**: Typed arrays for image data

## Testing Strategy

The architecture makes testing straightforward:

1. **Unit Tests**: Test domain entities and value objects in isolation
2. **Integration Tests**: Test use cases with mock infrastructure
3. **End-to-End Tests**: Test CLI commands with real files

## Benefits of This Architecture

1. **Maintainability**: Clear separation of concerns
2. **Testability**: Easy to test each layer independently
3. **Flexibility**: Easy to swap implementations
4. **Scalability**: Can add new features without breaking existing code
5. **Type Safety**: Catches errors at development time
6. **Clarity**: Business logic is clearly separated from technical details

## Future Enhancements

Potential improvements that fit the architecture:

1. **Object Mask Support**: Add full implementation for drawing specific objects
2. **Multiple Hand Styles**: Add strategy for different hand animations
3. **Video Formats**: Add support for different output formats
4. **Batch Processing**: Process multiple images in parallel
5. **Web API**: Add FastAPI presentation layer alongside CLI
6. **Custom Effects**: Add pluggable effect system
7. **Progress Reporting**: Enhanced progress tracking with Rich

## Dependencies Graph

```
Presentation Layer (CLI)
         ↓
Application Layer (Use Cases)
         ↓
Domain Layer (Entities + Value Objects)
         ↑
Infrastructure Layer (OpenCV, Video Writers)
```

The domain layer is at the center and knows nothing about outer layers, maintaining the core principle of Clean Architecture.
